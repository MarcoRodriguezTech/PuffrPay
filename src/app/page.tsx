"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LeashBar } from "@/components/LeashBar";
import { MASCOT_SRC, PufferGauge, STATE_LABELS, stateForRatio } from "@/components/PufferGauge";
import { usePufferDrift } from "@/components/puffer-drift";
import {
  consumePuffFlag,
  fmtDollars,
  fmtWhole,
  friendlyClientError,
  GENERIC_ERROR,
  isRateLimitMsg,
  refreshBudget,
  storeOf,
  toast,
  useCountUp,
} from "@/lib/ui";

interface ChatMsg {
  id: number;
  role: "owner" | "agent" | "system";
  content: string;
}

interface Step {
  step: string;
  detail: string;
}

interface Purchase {
  id: number;
  productTitle: string;
  merchantUrl: string | null;
  imageUrl: string | null;
  amountCents: number;
  status: string;
  policyDecision: string;
  policyReason: string;
  agentReasoning: string | null;
  paypalOrderId: string | null;
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
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [blockedAt, setBlockedAt] = useState<number | null>(null);
  const [busyError, setBusyError] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [pendingErr, setPendingErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "rejected" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mascotRef = useRef<HTMLSpanElement>(null);
  usePufferDrift(mascotRef, ".gauge-block", null, ".gauge-amount", budget != null);

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
    if (asks.length > 0) setPurchase((cur) => cur ?? asks[0]);
    refreshBudget();
  }, []);

  useEffect(() => {
    setBlockedAt(consumePuffFlag());
    refresh();
  }, [refresh]);

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, shown, busy]);

  async function send(raw?: string) {
    const message = (raw ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setBusyError(false);
    setPendingErr(null);
    setApproveUrl(null);
    setPurchase(null);
    setSteps([]);
    setShown(0);
    setOutcome(null);
    setLastMessage(message);
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

  async function decide(action: "approve" | "reject") {
    if (!purchase || deciding) return;
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

  async function captureNow() {
    if (!purchase || deciding) return;
    setDeciding(true);
    setPendingErr(null);
    try {
      const res = await fetch(`/api/purchases/${purchase.id}/capture`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "capture failed");
      appendStep({ step: "result", detail: "BOUGHT" });
      setPurchase(null);
      setApproveUrl(null);
      setOutcome("approved");
      toast("Payment sent (sandbox)");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPendingErr(
        msg.includes("ORDER_NOT_APPROVED")
          ? "PayPal says the order isn't approved yet — finish it in the PayPal window, then capture again."
          : friendlyClientError(err)
      );
    } finally {
      setDeciding(false);
      refresh();
    }
  }

  const awaitingOwner =
    purchase?.status === "WAITING" &&
    purchase.policyDecision === "ASK" &&
    !purchase.paypalOrderId;
  const paymentPending = purchase?.status === "WAITING" && !!purchase.paypalOrderId;

  const visibleSteps = steps.slice(0, shown);
  const pickIndex = visibleSteps.findIndex((s) => s.step === "pick");
  const showReasoning = pickIndex >= 0 && !!purchase?.agentReasoning;
  const blockedReason = purchase?.status === "BLOCKED" ? purchase.policyReason : null;
  const spentDisplay = useCountUp(budget?.spentCents ?? 0);
  const state = budget ? stateForRatio(budget.ratio) : "calm";

  return (
    <main className="agent-page">
      <div className="chat-col">
        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && steps.length === 0 && !busy ? (
            <div className="chat-empty">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MASCOT_SRC} alt="" width={140} height={140} />
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
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  {m.content}
                </div>
              ))}

              {(visibleSteps.length > 0 || busy) && (
                <div className="agent-log" aria-live="polite">
                  <div className="log-title">AGENT RECEIPT</div>
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

          {awaitingOwner && (
            <div className="approval-card">
              <div className="ac-head">Puffr needs your OK</div>
              <div className="ac-body">
                <div className="ac-detail">
                  {purchase.imageUrl && (
                    <img
                      className="product-thumb"
                      src={purchase.imageUrl}
                      alt={purchase.productTitle}
                      width={64}
                      height={64}
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
                  <button onClick={() => decide("approve")} disabled={deciding}>
                    {deciding && <span className="spinner" aria-hidden="true" />}
                    Approve
                  </button>
                  <button
                    className="secondary danger"
                    onClick={() => decide("reject")}
                    disabled={deciding}
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
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <span className="ac-amount">{fmtDollars(purchase.amountCents)}</span>
                    <div className="muted" style={{ fontSize: "0.9rem" }}>
                      {purchase.productTitle} — approve it in the PayPal sandbox
                      window and it captures automatically.
                    </div>
                  </div>
                  {pendingErr && (
                    <div className="card-err">
                      {pendingErr}
                      <button className="text" onClick={captureNow}>
                        Retry
                      </button>
                    </div>
                  )}
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
                  <button className="secondary" onClick={captureNow} disabled={deciding}>
                    {deciding && <span className="spinner" aria-hidden="true" />}
                    I&apos;ve approved — capture now
                  </button>
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
              placeholder="What should I buy?"
              disabled={busy}
              autoComplete="off"
            />
            <button type="submit" disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      </div>

      <aside className="agent-side">
        <div className="side-inner">
          <div className="side-title">Fun money — {MONTH}</div>
          {budget ? (
            <div className="gauge-block">
              <span className="gauge-mascot" ref={mascotRef}>
                <PufferGauge ratio={budget.ratio} size={160} blockedAt={blockedAt} />
              </span>
              <div className="gauge-amount">
                {fmtWhole(spentDisplay)}
                <span className="of"> of {fmtWhole(budget.capCents)}</span>
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
            <Link href="/policy">Edit policy</Link>
          </>
        )}
      </aside>
    </main>
  );
}
