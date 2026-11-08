"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LeashBar } from "@/components/LeashBar";
import { MASCOT_SRC, PufferGauge, STATE_LABELS, stateForRatio } from "@/components/PufferGauge";
import { ReceiptCard } from "@/components/ReceiptCard";
import {
  consumePuffFlag,
  fmtDollars,
  fmtWhole,
  friendlyClientError,
  GENERIC_ERROR,
  isRateLimitMsg,
  openReceipts,
  refreshBudget,
  storeOf,
  toast,
  useCountUp,
} from "@/lib/ui";

// motion (~140KB) only loads when a live options set actually renders.
const OptionStack = dynamic(() =>
  import("@/components/OptionStack").then((m) => m.OptionStack)
);

interface ChatMsg {
  id: number;
  role: "owner" | "agent" | "system";
  content: string;
}

/** Minimal shape of SpeechRecognition — the DOM lib types vary by TS version. */
interface SpeechRec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(): void;
  stop(): void;
}

interface OptionItem {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  merchantUrl: string | null;
  imageUrl: string | null;
  category: string | null;
  tag: string;
  reasoning: string;
  decision: "ALLOW" | "ASK" | "BLOCK";
  decisionReason: string;
}

interface OptionsPayload {
  v: 1;
  kind: "options";
  text: string;
  items: OptionItem[];
  /** Cards the owner X'd out — archived, never rendered here. */
  removed?: OptionItem[];
  picked?: string;
  dismissed?: boolean;
}

// JSON.parse per message per render is real work once history grows — the
// content string is immutable per message, so cache by it.
const optionsCache = new Map<string, OptionsPayload | null>();

function parseOptions(content: string): OptionsPayload | null {
  const hit = optionsCache.get(content);
  if (hit !== undefined) return hit;
  let parsed: OptionsPayload | null = null;
  try {
    const p = JSON.parse(content);
    if (p?.kind === "options" && Array.isArray(p.items)) parsed = p;
  } catch {
    /* plain text message */
  }
  optionsCache.set(content, parsed);
  return parsed;
}

function markPicked(content: string, productId: string): string {
  try {
    return JSON.stringify({ ...JSON.parse(content), picked: productId });
  } catch {
    return content;
  }
}

// The old "…needs owner approval. Approve or reject it below." lines are no
// longer generated — hide the ones already logged in chat history.
const ASK_NAG = /Approve or reject it below\.?\s*$/;
const isNagMsg = (m: ChatMsg) => m.role === "agent" && ASK_NAG.test(m.content);

interface Step {
  step: string;
  detail: string;
}

interface Purchase {
  id: number;
  createdAt: string;
  productTitle: string;
  merchantUrl: string | null;
  imageUrl: string | null;
  amountCents: number;
  status: string;
  policyDecision: string;
  policyReason: string;
  agentReasoning: string | null;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  decidedBy: "policy" | "owner";
  updatedAt: string;
  errorMessage: string | null;
}

interface Budget {
  spentCents: number;
  capCents: number;
  ratio: number;
}

interface Policy {
  monthlyCapCents: number;
  perPurchaseMaxCents: number;
  autoApproveUnderCents: number;
  blockedCategories: string[];
}

const EXAMPLES = [
  "Find a birthday gift for my sister under $50",
  "I need a phone charger under $20",
  "Find something over $100",
];

const MONTH = new Date().toLocaleString("en-US", { month: "long" });

/** 'Puffr says no. <reason>' with the house voice per reason. */
function blockedCopy(reason: string, policy?: Policy | null): string {
  const r = reason.toLowerCase();
  if (r.includes("monthly cap"))
    return "Puffr is full. Fun money is used up until next month.";
  if (r.includes("per purchase max"))
    return `Puffr says no. Over your ${policy ? fmtWhole(policy.perPurchaseMaxCents) : "per-purchase"} limit.`;
  if (r.includes("blocked category"))
    return `Puffr says no. That's on your blocked list.`;
  return `Puffr says no. ${reason}.`;
}

// The last word of a policy line gets a PASS/FAIL/YES/NO tag.
function logLine(s: Step, i: number) {
  const m = s.detail.match(/^(.*?)\s(PASS|FAIL|YES|NO)$/);
  if (!m) {
    return (
      <div
        className={`line ${s.step === "result" && s.detail.startsWith("BLOCKED") ? "blocked" : ""}`}
        key={i}
      >
        [{s.step}] {s.detail}
      </div>
    );
  }
  const pass = m[2] === "PASS" || m[2] === "YES";
  return (
    <div className="line" key={i}>
      [{s.step}] {m[1]}{" "}
      <span className={`tag ${pass ? "pass" : "fail"}`}>
        {pass ? "✓" : "✗"} {m[2]}
      </span>
    </div>
  );
}

export default function AgentPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [shown, setShown] = useState(0);
  const [revealKey, setRevealKey] = useState(0);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [input, setInput] = useState("");
  // Voice input — Web Speech API. The transcript lands in the input as a
  // draft; the owner still reviews and hits Send (never auto-submit speech).
  const [speechOk, setSpeechOk] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [blockedAt, setBlockedAt] = useState<number | null>(null);
  const [busyError, setBusyError] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<"approved" | "rejected" | null>(null);
  // the last successfully bought purchase — kept so a receipt card can show
  const [receipt, setReceipt] = useState<Purchase | null>(null);
  // once the owner hides an approval card, no WAITING ask surfaces in the
  // agent view again this session — they still queue in Controls. hideAsksAt
  // also gates the pointer: only asks created after the mute get one flash.
  const [hideAsks, setHideAsks] = useState(false);
  const [hideAsksAt, setHideAsksAt] = useState(0);
  // asks the "waiting" pointer has already flashed for — it shows once each
  const [seenAsks, setSeenAsks] = useState<Set<number>>(new Set());
  const [choosing, setChoosing] = useState<number | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // start of the in-flight request — the waiting-poll only surfaces asks
  // created after this, never stale queued ones
  const requestStartRef = useRef(0);

  const appendStep = useCallback((s: Step) => {
    setSteps((prev) => [...prev, s]);
    setShown((n) => n + 1);
  }, []);

  const refresh = useCallback(async () => {
    const [b, p, chat, waiting] = await Promise.all([
      fetch("/api/budget").then((r) => r.json()).catch(() => null),
      fetch("/api/policy").then((r) => r.json()).catch(() => null),
      fetch("/api/agent").then((r) => r.json()).catch(() => null),
      fetch("/api/purchases?status=WAITING").then((r) => r.json()).catch(() => null),
    ]);
    if (b?.capCents != null) setBudget(b);
    if (p?.monthlyCapCents != null) setPolicy(p);
    if (chat?.messages) setMessages(chat.messages);
    const asks = (waiting?.purchases ?? []).filter(
      (x: Purchase) => x.policyDecision === "ASK" && !x.paypalOrderId
    );
    const waitingById = new Map<number, Purchase>(
      (waiting?.purchases ?? []).map((x: Purchase) => [x.id, x])
    );
    setPurchase((cur) => {
      // A WAITING purchase resolved elsewhere (rejected/cancelled/captured
      // in Controls) drops off; one still live picks up server-side changes
      // (e.g. an order id attached by a Controls approve). id 0 is the
      // optimistic card — the in-flight response owns it.
      if (cur && cur.id !== 0 && cur.status === "WAITING") {
        return waitingById.get(cur.id) ?? asks[0] ?? null;
      }
      return cur ?? asks[0] ?? null;
    });
    refreshBudget();
  }, []);

  useEffect(() => {
    setBlockedAt(consumePuffFlag());
    refresh();
    const w = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    setSpeechOk(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    return () => recRef.current?.stop();
  }, [refresh]);

  function toggleVoice() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: unknown) => {
      const ev = e as {
        results: { length: number; [i: number]: { [j: number]: { transcript: string } } };
      };
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
      setInput(text);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    rec.onerror = (e: unknown) => {
      const err = e as { error?: string };
      if (err.error === "not-allowed" || err.error === "service-not-allowed") {
        toast("Microphone blocked — allow mic access for this site");
      }
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  // reveal log lines one every 120ms once the response lands
  useEffect(() => {
    if (revealKey === 0) return;
    const t = setInterval(
      () => setShown((n) => (n >= steps.length ? (clearInterval(t), n) : n + 1)),
      120
    );
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  // The receipt opens while steps stream in, then folds into a stub you can
  // re-expand — the "thoughts" disclosure pattern.
  useEffect(() => {
    if (busy || shown < steps.length) {
      setLogOpen(true);
      return;
    }
    if (steps.length === 0) return;
    const t = setTimeout(() => setLogOpen(false), 1200);
    return () => clearTimeout(t);
  }, [busy, shown, steps.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, shown, busy]);

  async function send(raw?: string) {
    const message = (raw ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setBusyError(false);
    setApproveUrl(null);
    setPurchase(null);
    setReceipt(null);
    setSteps([]);
    setShown(0);
    setOutcome(null);
    setLastMessage(message);
    requestStartRef.current = Date.now();
    setMessages((m) => [...m, { id: Date.now(), role: "owner", content: message }]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "the agent failed");
      setSteps(data.steps ?? []);
      setShown(0);
      setRevealKey((k) => k + 1);
      setPurchase(data.purchase ?? null);
      setApproveUrl(data.approveUrl ?? null);
      if (data.reply) {
        setMessages((m) => [...m, { id: Date.now() + 1, role: "agent", content: data.reply }]);
      }
      if (data.purchase?.status === "BLOCKED") {
        setBlockedAt(Date.now());
        toast(blockedCopy(data.purchase.policyReason, policy));
      } else if (data.purchase?.status === "PURCHASED") {
        setReceipt(data.purchase);
        toast("Bought. Under your auto-approve limit.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitMsg(msg)) {
        setBusyError(true);
      } else {
        console.error("[agent] send failed:", err);
        setMessages((m) => [
          ...m,
          { id: Date.now() + 1, role: "agent", content: GENERIC_ERROR },
        ]);
      }
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const choose = useCallback(async (messageId: number, productId: string) => {
    if (choosing != null || busy) return;
    // The picked card's stamped verdict is known before the round-trip — an
    // ASK gets an optimistic approval card instantly (id 0 keeps the buttons
    // disabled until the real purchase lands).
    const item = parseOptions(
      messages.find((x) => x.id === messageId)?.content ?? ""
    )?.items.find((i) => i.id === productId);
    setChoosing(messageId);
    setBusyError(false);
    setApproveUrl(null);
    setPurchase(null);
    setReceipt(null);
    setOutcome(null);
    setSteps([]);
    setShown(0);
    requestStartRef.current = Date.now();
    if (item?.decision === "ASK") {
      const now = new Date().toISOString();
      setPurchase({
        id: 0,
        createdAt: now,
        productTitle: item.title,
        merchantUrl: item.merchantUrl,
        imageUrl: item.imageUrl,
        amountCents: item.priceCents,
        status: "WAITING",
        policyDecision: "ASK",
        policyReason: item.decisionReason,
        agentReasoning: item.reasoning,
        paypalOrderId: null,
        paypalCaptureId: null,
        decidedBy: "policy",
        updatedAt: now,
        errorMessage: null,
      });
    }
    try {
      const res = await fetch("/api/agent/choose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, productId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "pick failed");
      setSteps(data.steps ?? []);
      setShown(0);
      setRevealKey((k) => k + 1);
      setPurchase(data.purchase ?? null);
      setApproveUrl(data.approveUrl ?? null);
      if (data.reply) {
        setMessages((m) => [
          ...m.map((x) =>
            x.id === messageId
              ? { ...x, content: markPicked(x.content, productId) }
              : x
          ),
          { id: Date.now() + 1, role: "agent", content: data.reply },
        ]);
      }
      if (data.purchase?.status === "BLOCKED") {
        setBlockedAt(Date.now());
        toast(blockedCopy(data.purchase.policyReason, policy));
      } else if (data.purchase?.status === "PURCHASED") {
        setReceipt(data.purchase);
        toast("Bought. Under your auto-approve limit.");
      }
    } catch (err) {
      console.error("[agent] choose failed:", err);
      setPurchase(null);
      toast(friendlyClientError(err));
    } finally {
      setChoosing(null);
      refresh();
    }
  }, [busy, choosing, policy, refresh, messages]);

  // Non-pick edits to the live options set: bail entirely ("wasn't able to
  // choose") or drop one card (e.g. a blocked item). Server persists the
  // payload so the change survives reload.
  const editOptions = useCallback(async (
    messageId: number,
    change: { dismiss?: boolean; remove?: string }
  ) => {
    if (choosing != null || busy) return;
    setChoosing(messageId);
    try {
      const res = await fetch("/api/agent/choose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, ...change }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "update failed");
      if (data.payload) {
        const json = JSON.stringify(data.payload);
        setMessages((m) =>
          m.map((x) => (x.id === messageId ? { ...x, content: json } : x))
        );
      }
    } catch (err) {
      console.error("[agent] options edit failed:", err);
      toast(friendlyClientError(err));
    } finally {
      setChoosing(null);
    }
  }, [busy, choosing]);

  async function decide(action: "approve" | "reject") {
    // id 0 is the optimistic card — no real purchase to act on yet
    if (!purchase || purchase.id === 0 || deciding) return;
    setDeciding(true);
    try {
      const res = await fetch(`/api/purchases/${purchase.id}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      const p: Purchase = data.purchase;
      if (action === "reject") {
        appendStep({ step: "result", detail: "REJECTED" });
        setPurchase(null);
        setOutcome("rejected");
        toast("Rejected");
      } else if (p.status === "PURCHASED") {
        appendStep({ step: "result", detail: "BOUGHT" });
        setPurchase(null);
        setReceipt(p);
        setOutcome("approved");
        toast("Payment sent (sandbox)");
      } else if (p.status === "BLOCKED") {
        const reason = (p.errorMessage ?? p.policyReason).replace(
          /^blocked on re-check:\s*/i,
          ""
        );
        appendStep({ step: "result", detail: `BLOCKED: ${reason}` });
        setPurchase(null);
        setOutcome(null);
        setBlockedAt(Date.now());
        toast(blockedCopy(reason, policy));
      } else {
        // real PayPal order created — owner finishes in the sandbox window
        appendStep({ step: "result", detail: "PAYMENT STARTED" });
        setPurchase(p);
        setApproveUrl(data.approveUrl ?? null);
      }
    } catch (err) {
      toast(friendlyClientError(err));
    } finally {
      setDeciding(false);
      refresh();
    }
  }

  const askWaiting =
    purchase?.status === "WAITING" &&
    purchase.policyDecision === "ASK" &&
    !purchase.paypalOrderId;
  const awaitingOwner = askWaiting && !hideAsks;
  const askId = askWaiting ? purchase.id : null;
  const showAskNote =
    askWaiting &&
    hideAsks &&
    askId != null &&
    !seenAsks.has(askId) &&
    // only asks that arrived after the mute flash — old queued asks were
    // already sitting there when the owner hid the card
    new Date(purchase.createdAt).getTime() > hideAsksAt;

  // While a request is in flight, surface an ASK the moment its row exists —
  // the card doesn't wait for the full round-trip. Gated to asks created
  // after the request started so older queued asks are never resurrected.
  useEffect(() => {
    if (!busy && choosing == null) return;
    const iv = setInterval(async () => {
      const r = await fetch("/api/purchases?status=WAITING")
        .then((x) => x.json())
        .catch(() => null);
      const all: Purchase[] = r?.purchases ?? [];
      const asks = all.filter(
        (x: Purchase) =>
          x.policyDecision === "ASK" &&
          !x.paypalOrderId &&
          new Date(x.createdAt).getTime() > requestStartRef.current
      );
      setPurchase((cur) => {
        if (cur?.id === 0) return cur; // optimistic card — response owns it
        if (cur && cur.status === "WAITING") {
          const fresh = all.find((x) => x.id === cur.id);
          return fresh ?? asks[0] ?? null;
        }
        return cur ?? asks[0] ?? null;
      });
    }, 500);
    return () => clearInterval(iv);
  }, [busy, choosing]);

  // the pointer flashes once per ask — auto-dismiss after a few seconds
  useEffect(() => {
    if (!showAskNote || askId == null) return;
    const t = setTimeout(
      () => setSeenAsks((s) => new Set(s).add(askId)),
      8000
    );
    return () => clearTimeout(t);
  }, [showAskNote, askId]);
  const paymentPending = purchase?.status === "WAITING" && !!purchase.paypalOrderId;

  // While a checkout is open, sweep every 8s: reconcile catches orders the
  // buyer approved in PayPal (even when the return redirect never reached
  // us), and the list check catches rows resolved another way (return-URL
  // capture, a cancel in Controls). Either path ends in the receipt.
  const purchaseId = purchase?.id ?? null;
  useEffect(() => {
    if (!paymentPending || purchaseId == null) return;
    const sweep = async () => {
      const rec = await fetch("/api/purchases/reconcile", { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      let mine: Purchase | undefined = (rec?.resolved ?? []).find(
        (x: Purchase) => x.id === purchaseId
      );
      if (!mine) {
        const [pb, rb] = await Promise.all([
          fetch("/api/purchases?status=PURCHASED").then((r) => r.json()).catch(() => null),
          fetch("/api/purchases?status=REJECTED").then((r) => r.json()).catch(() => null),
        ]);
        mine =
          (pb?.purchases ?? []).find((x: Purchase) => x.id === purchaseId) ??
          (rb?.purchases ?? []).find((x: Purchase) => x.id === purchaseId);
      }
      if (!mine) return;
      if (mine.status === "PURCHASED") {
        appendStep({ step: "result", detail: "BOUGHT" });
        setReceipt(mine);
        setOutcome("approved");
        toast("Payment sent (sandbox)");
      } else {
        toast("Checkout expired on PayPal");
      }
      setPurchase(null);
      setApproveUrl(null);
      refresh();
    };
    sweep();
    const iv = setInterval(sweep, 8_000);
    return () => clearInterval(iv);
  }, [paymentPending, purchaseId, appendStep, refresh]);

  // The live options set is the latest options message — live only while
  // nothing's been picked from it. Older unpicked sets render as the plain
  // inline carousel; picked ones collapse to the chosen product's card.
  const activeOptions = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "agent") continue;
      const p = parseOptions(m.content);
      if (!p) continue;
      const done = p.picked || p.dismissed || p.items.length === 0;
      return done ? null : { msgId: m.id, payload: p };
    }
    return null;
  }, [messages]);

  const visibleSteps = steps.slice(0, shown);
  const pickIndex = visibleSteps.findIndex((s) => s.step === "pick");
  const showReasoning = pickIndex >= 0 && !!purchase?.agentReasoning;
  const blockedReason = purchase?.status === "BLOCKED" ? purchase.policyReason : null;

  // The receipt is the dropdown that leads the response: while a reply is
  // in flight it sits at the tail of the feed; once the reply lands it
  // tucks in right before that bubble.
  const showReceipt = visibleSteps.length > 0 || busy;
  const feed = useMemo(() => messages.filter((m) => !isNagMsg(m)), [messages]);
  const lastIsAgent = feed[feed.length - 1]?.role === "agent";
  const receiptIdx = !busy && lastIsAgent ? feed.length - 1 : feed.length;
  const receiptEl = showReceipt && (
    <div className={`agent-log${logOpen ? " open" : " closed"}`} aria-live="polite">
      <button
        type="button"
        className="log-title"
        onClick={() => setLogOpen((o) => !o)}
        aria-expanded={logOpen}
      >
        <svg className="log-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2.5 3.5 5 6l2.5-2.5" />
        </svg>
        AGENT RECEIPT
        <span className="log-count">{visibleSteps.length}</span>
      </button>
      {logOpen && (
        <div className="log-body">
          {visibleSteps.map((s, i) => (
            <div key={i}>
              {logLine(s, i)}
              {i === pickIndex && purchase && (
                <div className="product-card">
                  {purchase.imageUrl ? (
                    <img
                      className="thumb"
                      src={purchase.imageUrl}
                      alt={purchase.productTitle}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="thumb" aria-hidden="true">
                      {purchase.productTitle?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                  <span className="meta">
                    <span className="t">{purchase.productTitle}</span>
                    <span className="s">{storeOf(purchase.merchantUrl)}</span>
                    <span className="p">{fmtDollars(purchase.amountCents)}</span>
                  </span>
                </div>
              )}
              {i === pickIndex && showReasoning && (
                <div className="log-reason">{purchase?.agentReasoning}</div>
              )}
            </div>
          ))}
          {busy && (
            <div className="typing">
              Shopping<span className="dots" aria-hidden="true" />
            </div>
          )}
        </div>
      )}
    </div>
  );
  const spentDisplay = useCountUp(budget?.spentCents ?? 0);
  const state = budget ? stateForRatio(budget.ratio) : "calm";

  return (
    <main className="agent-page">
      <div className="chat-col">
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && steps.length === 0 && !busy ? (
            <div className="chat-empty">
              {/* Art is 1024x629 — dims match its real ratio; height:auto
                  keeps it undistorted if the file is ever swapped. */}
              <Image src={MASCOT_SRC} alt="" width={140} height={86} quality={90} style={{ height: "auto" }} />
              <h1>What should I buy?</h1>
              <p className="muted">Your fun money, on a leash.</p>
              <div className="examples">
                {EXAMPLES.map((e) => (
                  <button key={e} className="chip" onClick={() => setInput(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {feed.map((m, i) => (
                <Fragment key={m.id}>
                  {i === receiptIdx && receiptEl}
                  <ChatMessageRow
                    m={m}
                    live={activeOptions?.msgId === m.id}
                    busy={choosing === m.id}
                    onPick={choose}
                  />
                </Fragment>
              ))}
              {receiptIdx === feed.length && receiptEl}

              {blockedReason && !busy && (
                <div className="blocked-strip" role="status">
                  <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                  {blockedCopy(blockedReason, policy)}
                </div>
              )}
            </>
          )}
        </div>

        <div className="chat-bottom">
          {outcome === "approved" && (
            <div className="done-strip" role="status">
              <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 6.5 5 9.5 10 3" />
              </svg>
              Done — Puffr bought it.
            </div>
          )}

          {receipt && (
            <div className="chat-receipt">
              <ReceiptCard purchase={receipt} />
              <button
                type="button"
                className="text"
                onClick={openReceipts}
              >
                All receipts
              </button>
            </div>
          )}

          {showAskNote && (
            <div className="muted ask-note">
              An approval is waiting —{" "}
              <Link href="/policy">decide it in Controls</Link>.
              <button
                type="button"
                className="ac-dismiss"
                aria-label="Dismiss"
                onClick={() =>
                  askId != null &&
                  setSeenAsks((s) => new Set(s).add(askId))
                }
              >
                ×
              </button>
            </div>
          )}

          {awaitingOwner && (
            <div className="approval-card">
              <div className="ac-head">
                Puffr needs your OK
                <button
                  type="button"
                  className="ac-dismiss"
                  aria-label="Hide approvals from agent — still waiting in Controls"
                  title="Hide approvals — still waiting in Controls"
                  onClick={() => {
                    setHideAsks(true);
                    setHideAsksAt(Date.now());
                    // dismissing the card also counts as having seen the
                    // pointer for this ask — no immediate re-flash
                    setSeenAsks((s) => new Set(s).add(purchase.id));
                    // …but the dismissed ask leaves a trace in the feed
                    setMessages((m) => [
                      ...m,
                      {
                        id: Date.now(),
                        role: "agent",
                        content: `"${purchase.productTitle}" is ${fmtDollars(purchase.amountCents)} — needs owner approval. Decide it in Controls.`,
                      },
                    ]);
                  }}
                >
                  ×
                </button>
              </div>
              <div className="ac-body">
                <div className="ac-detail">
                  {purchase.imageUrl && (
                    <img
                      className="product-thumb"
                      src={purchase.imageUrl}
                      alt={purchase.productTitle}
                      width={64}
                      height={64}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <span className="ac-amount">{fmtDollars(purchase.amountCents)}</span>
                    <div>{purchase.productTitle}</div>
                    <div className="muted" style={{ fontSize: "0.9rem" }}>
                      {storeOf(purchase.merchantUrl)} — {purchase.agentReasoning}
                    </div>
                  </div>
                </div>
                <div className="actions">
                  <button
                    onClick={() => decide("approve")}
                    disabled={deciding || purchase.id === 0}
                  >
                    {purchase.id === 0 && (
                      <span className="spinner" aria-hidden="true" />
                    )}
                    {deciding && <span className="spinner" aria-hidden="true" />}
                    Approve
                  </button>
                  <button
                    className="secondary danger"
                    onClick={() => decide("reject")}
                    disabled={deciding || purchase.id === 0}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )}

          {paymentPending && (
            <div className="approval-card">
              <div className="ac-head">Finish it in the sandbox</div>
              <div className="ac-body">
                <div className="ac-detail">
                  {purchase.imageUrl && (
                    <img
                      className="product-thumb"
                      src={purchase.imageUrl}
                      alt={purchase.productTitle}
                      width={64}
                      height={64}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <span className="ac-amount">{fmtDollars(purchase.amountCents)}</span>
                    <div className="muted" style={{ fontSize: "0.9rem" }}>
                      {purchase.productTitle} — approve it in the PayPal sandbox
                      window and it captures automatically.
                    </div>
                  </div>
                </div>
                <div className="actions">
                  {approveUrl && (
                    <a
                      className="secondary"
                      href={approveUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        minHeight: 44,
                        padding: "0 16px",
                        border: "1px solid var(--ink)",
                        borderRadius: "var(--radius-ctl)",
                        textDecoration: "none",
                        color: "var(--ink)",
                        fontWeight: 500,
                      }}
                    >
                      Open PayPal sandbox
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {busyError && (
            <div className="error">
              Puffr is catching its breath. Try again in a minute.{" "}
              <button className="text" onClick={() => lastMessage && send(lastMessage)}>
                Retry
              </button>
            </div>
          )}

          {activeOptions && (
            <OptionStack
              msgId={activeOptions.msgId}
              payload={activeOptions.payload}
              busy={choosing === activeOptions.msgId}
              onPick={choose}
              onDismiss={(id) => editOptions(id, { dismiss: true })}
              onRemove={(id, pid) => editOptions(id, { remove: pid })}
            />
          )}

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label className="visually-hidden" htmlFor="agent-msg">
              Message the agent
            </label>
            <input
              id="agent-msg"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Listening…" : "What should I buy?"}
              disabled={busy}
              autoComplete="off"
            />
            {speechOk && (
              <button
                type="button"
                className={`mic-btn${listening ? " live" : ""}`}
                onClick={toggleVoice}
                disabled={busy}
                aria-pressed={listening}
                aria-label={listening ? "Stop dictation" : "Dictate a request"}
                title={listening ? "Listening — click to stop" : "Speak your request"}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                </svg>
              </button>
            )}
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      </div>

      <aside className="agent-side">
        <div className="side-scroll">
        <div className="side-inner">
          <div className="side-title">Fun money — {MONTH}</div>
          {budget ? (
            <div className="gauge-block">
              <PufferGauge ratio={budget.ratio} size={200} blockedAt={blockedAt} />
              <div className="gauge-amount">
                {fmtWhole(spentDisplay)}
                <span className="of"> / {fmtWhole(budget.capCents)}</span>
              </div>
              <div style={{ width: "100%", marginTop: "var(--s3)" }}>
                <LeashBar ratio={budget.ratio} width={180} />
              </div>
              <div className="gauge-state">
                {Math.round(budget.ratio * 100)}% — {STATE_LABELS[state]}
              </div>
            </div>
          ) : (
            <p className="muted">Loading...</p>
          )}
        </div>
        {policy && (
          <>
            <hr className="divider" />
            <div className="rule-row">
              <span className="muted">Monthly cap</span>
              <span className="v">{fmtWhole(policy.monthlyCapCents)}</span>
            </div>
            <div className="rule-row">
              <span className="muted">Per purchase max</span>
              <span className="v">{fmtWhole(policy.perPurchaseMaxCents)}</span>
            </div>
            <div className="rule-row">
              <span className="muted">Auto-approve under</span>
              <span className="v">{fmtWhole(policy.autoApproveUnderCents)}</span>
            </div>
            <hr className="divider" />
            <Link href="/policy">Edit rules</Link>
          </>
        )}
        </div>
        <div className="side-note">
          Sandbox mode. No real money moves.
        </div>
      </aside>
    </main>
  );
}

/** One chat row — memoized so keystrokes / reveal ticks don't rebuild history. */
const ChatMessageRow = memo(function ChatMessageRow({
  m,
  live,
  busy,
  onPick,
}: {
  m: ChatMsg;
  live: boolean;
  busy: boolean;
  onPick: (messageId: number, productId: string) => void;
}) {
  const opts = m.role === "agent" ? parseOptions(m.content) : null;
  if (opts) {
    if (opts.dismissed) {
      return (
        <div className="msg agent">
          <div>{opts.text}</div>
          <div className="opt-skipped">Skipped — nothing picked.</div>
        </div>
      );
    }
    if (opts.picked) {
      const it = opts.items.find((x) => x.id === opts.picked);
      return (
        <div className="msg agent opt-wrap">
          <div>{opts.text}</div>
          {it && (
            <div className="opt-picked-card">
              {it.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="product-thumb"
                  src={it.imageUrl}
                  alt={it.title}
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="product-thumb" aria-hidden="true">
                  {it.title?.[0]?.toUpperCase() ?? "?"}
                </span>
              )}
              <span className="meta">
                <span className="t">{it.title}</span>
                <span className="s">{storeOf(it.merchantUrl)}</span>
                <span className="p">{fmtDollars(it.priceCents)}</span>
              </span>
              <span className="opt-chip allow">Picked</span>
            </div>
          )}
        </div>
      );
    }
    // The live (latest, unpicked) options render as the stacked carousel above
    // the input — the message keeps just its text.
    if (live) {
      return <div className="msg agent">{opts.text}</div>;
    }
    return (
      <OptionCarousel msgId={m.id} payload={opts} busy={busy} onPick={onPick} />
    );
  }
  return <div className={`msg ${m.role}`}>{m.content}</div>;
});

/** Horizontal suggestion row the agent leaves in chat; the owner picks a card. */
function OptionCarousel({
  msgId,
  payload,
  busy,
  onPick,
}: {
  msgId: number;
  payload: OptionsPayload;
  busy: boolean;
  onPick: (messageId: number, productId: string) => void;
}) {
  const picked = payload.picked;
  return (
    <div className="msg agent opt-wrap">
      <div>{payload.text}</div>
      <div className="option-carousel" role="list">
        {payload.items.map((it) => {
          const blocked = it.decision === "BLOCK";
          const isPicked = picked === it.id;
          return (
            <div
              key={it.id}
              role="listitem"
              className={`opt-card${blocked ? " blocked" : ""}${isPicked ? " picked" : ""}`}
            >
              {it.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="product-thumb opt-thumb"
                  src={it.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="product-thumb opt-thumb" aria-hidden="true">
                  {it.title?.[0]?.toUpperCase() ?? "?"}
                </span>
              )}
              <span className="opt-tag">{it.tag}</span>
              <span className="opt-title">{it.title}</span>
              <span className="opt-price">
                {fmtDollars(it.priceCents)}
                <span className="s">{storeOf(it.merchantUrl)}</span>
              </span>
              <span className={`opt-chip ${it.decision.toLowerCase()}`}>
                {it.decision === "ALLOW"
                  ? "Auto-buys"
                  : it.decision === "ASK"
                    ? "Needs your OK"
                    : "Blocked"}
              </span>
              {blocked ? (
                <span className="opt-blocked">{it.decisionReason}</span>
              ) : (
                <button
                  type="button"
                  className="opt-pick"
                  onClick={() => onPick(msgId, it.id)}
                  disabled={busy || picked != null}
                >
                  {busy && <span className="spinner" aria-hidden="true" />}
                  {isPicked ? "Picked" : "Pick this"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
