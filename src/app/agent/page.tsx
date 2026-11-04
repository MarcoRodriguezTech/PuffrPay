"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PufferGauge } from "@/components/PufferGauge";

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
  amountCents: number;
  status: string;
  policyDecision: string;
  policyReason: string;
  agentReasoning: string | null;
  paypalOrderId: string | null;
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

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function AgentPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  const [stub, setStub] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockedFlash, setBlockedFlash] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [b, p, chat] = await Promise.all([
      fetch("/api/budget").then((r) => r.json()).catch(() => null),
      fetch("/api/policy").then((r) => r.json()).catch(() => null),
      fetch("/api/agent").then((r) => r.json()).catch(() => null),
    ]);
    if (b?.capCents != null) setBudget(b);
    if (p?.monthlyCapCents != null) setPolicy(p);
    if (chat?.messages) setMessages(chat.messages);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [steps]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setNotice(null);
    setBlockedFlash(false);
    setApproveUrl(null);
    setPurchase(null);
    setMessages((m) => [...m, { id: Date.now(), role: "owner", content: message }]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "agent failed");
      setSteps(data.steps ?? []);
      setPurchase(data.purchase);
      setApproveUrl(data.approveUrl ?? null);
      setStub(data.stub ?? false);
      if (data.reply) {
        setMessages((m) => [
          ...m,
          { id: Date.now() + 1, role: "agent", content: data.reply },
        ]);
      }
      if (data.purchase?.status === "BLOCKED") {
        setBlockedFlash(true);
        setNotice(`Blocked: ${data.purchase.policyReason}. The puffer puffs up.`);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: "agent",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function decide(id: number, action: "approve" | "reject") {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/purchases/${id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      if (action === "reject") {
        setPurchase(data.purchase);
        setNotice("Rejected. Nothing reaches PayPal.");
      } else {
        setPurchase(data.purchase);
        setApproveUrl(data.approveUrl ?? null);
        setStub(data.stub ?? false);
        if (data.purchase?.status === "BLOCKED") {
          setBlockedFlash(true);
          setNotice(`Re-check blocked it: ${data.purchase.errorMessage}`);
        }
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function completePayment(id: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/purchases/${id}/capture`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "capture failed");
      setPurchase(data.purchase);
      setApproveUrl(null);
      setNotice(
        stub
          ? "Stub payment captured (no PayPal keys configured — dev mode)."
          : "Sandbox payment captured. Check your PayPal sandbox dashboard."
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const needsOwner =
    purchase?.status === "WAITING" && purchase.policyDecision === "ASK";
  const needsPayment = purchase?.status === "WAITING" && !!purchase.paypalOrderId;

  return (
    <main className="page">
      <div className="two-col">
        <section>
          <div className="chat-list">
            {messages.length === 0 && (
              <div className="muted">
                Tell the agent what to buy, e.g. “find a birthday gift for my
                sister, she climbs, under $50”.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg ${m.role}`}>
                <span className="muted mono">{m.role.toUpperCase()}&gt; </span>
                {m.content}
              </div>
            ))}
          </div>

          {steps.length > 0 && (
            <div className="agent-log" ref={logRef}>
              <div className="muted">AGENT LOG</div>
              {steps.map((s, i) => (
                <div key={i}>
                  [{s.step}] {s.detail}
                </div>
              ))}
            </div>
          )}

          {needsOwner && (
            <div className="approve-card">
              <div className="row spread">
                <strong>Approve {fmt(purchase.amountCents)}?</strong>
                <span className="mono">{purchase.productTitle}</span>
              </div>
              <p className="muted">{purchase.agentReasoning}</p>
              <div className="row">
                <button disabled={busy} onClick={() => decide(purchase.id, "approve")}>
                  Approve
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => decide(purchase.id, "reject")}
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {needsPayment && (
            <div className="approve-card">
              <div className="row spread">
                <strong>Finish payment for {fmt(purchase.amountCents)}</strong>
              </div>
              <p className="muted">
                {approveUrl
                  ? "Approve in the PayPal sandbox window — you land back here and it captures automatically."
                  : "Dev stub (no PayPal keys). Capturing marks the request purchased."}
              </p>
              <div className="row">
                {approveUrl && (
                  <a
                    href={approveUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-block",
                      padding: "0.45rem 0.9rem",
                      border: "1px solid var(--ink)",
                      borderRadius: "var(--radius)",
                      background: "var(--ink)",
                      color: "var(--accent-ink)",
                      textDecoration: "none",
                    }}
                  >
                    Open PayPal sandbox
                  </a>
                )}
                <button
                  className={approveUrl ? "secondary" : ""}
                  disabled={busy}
                  onClick={() => completePayment(purchase.id)}
                >
                  {approveUrl ? "I've approved — capture now" : "Complete stub payment"}
                </button>
              </div>
            </div>
          )}

          {purchase?.status === "PURCHASED" && (
            <div className="notice">Purchased: {purchase.productTitle}</div>
          )}
          {notice && <div className="notice">{notice}</div>}

          <div className="chat-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Tell the agent what to buy..."
              disabled={busy}
            />
            <button onClick={send} disabled={busy}>
              Send
            </button>
          </div>
        </section>

        <aside>
          <div className="card">
            <div className="muted mono">ALLOWANCE</div>
            {budget ? (
              <PufferGauge
                ratio={budget.ratio}
                spentCents={budget.spentCents}
                capCents={budget.capCents}
                size={150}
                flash={blockedFlash}
              />
            ) : (
              <p className="muted">loading…</p>
            )}
          </div>
          {policy && (
            <div className="card mono" style={{ fontSize: "0.85rem" }}>
              <div className="muted">CURRENT RULES</div>
              <div>Monthly cap: {fmt(policy.monthlyCapCents)}</div>
              <div>Per-purchase max: {fmt(policy.perPurchaseMaxCents)}</div>
              <div>Auto-approve under: {fmt(policy.autoApproveUnderCents)}</div>
              {policy.blockedCategories.length > 0 && (
                <div>Blocked: {policy.blockedCategories.join(", ")}</div>
              )}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
