"use client";

import { useCallback, useEffect, useState } from "react";

interface Purchase {
  id: number;
  createdAt: string;
  productTitle: string;
  merchantUrl: string | null;
  amountCents: number;
  policyReason: string;
  agentReasoning: string | null;
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const toDollars = (c: number) => (c / 100).toFixed(2);

export default function PolicyPage() {
  const [form, setForm] = useState({
    monthlyCap: "",
    perPurchaseMax: "",
    autoApproveUnder: "",
    blockedCategories: "",
  });
  const [waiting, setWaiting] = useState<Purchase[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, waitingRes] = await Promise.all([
      fetch("/api/policy").then((r) => r.json()).catch(() => null),
      fetch("/api/purchases?status=WAITING")
        .then((r) => r.json())
        .catch(() => null),
    ]);
    if (p?.monthlyCapCents != null) {
      setForm({
        monthlyCap: toDollars(p.monthlyCapCents),
        perPurchaseMax: toDollars(p.perPurchaseMaxCents),
        autoApproveUnder: toDollars(p.autoApproveUnderCents),
        blockedCategories: p.blockedCategories.join(", "),
      });
    }
    // queue shows only ASK decisions waiting on the owner, not pending payments
    setWaiting(
      (waitingRes?.purchases ?? []).filter(
        (x: Purchase & { policyDecision?: string }) =>
          (x as { policyDecision?: string }).policyDecision === "ASK"
      )
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyCapCents: Math.round(parseFloat(form.monthlyCap) * 100),
          perPurchaseMaxCents: Math.round(parseFloat(form.perPurchaseMax) * 100),
          autoApproveUnderCents: Math.round(
            parseFloat(form.autoApproveUnder) * 100
          ),
          blockedCategories: form.blockedCategories
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setMsg("Policy saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: number, action: "approve" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/purchases/${id}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      if (action === "approve") {
        // payment started — let the owner finish it on the Agent screen
        setMsg(
          data.approveUrl
            ? "Approved. Open the Agent screen to finish the PayPal sandbox payment."
            : "Approved (dev stub). Open the Agent screen to complete it."
        );
      } else {
        setMsg("Rejected.");
      }
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="two-col">
        <section>
          <h2 style={{ marginTop: 0 }}>Waiting for you ({waiting.length})</h2>
          {waiting.length === 0 && (
            <p className="muted">Nothing is waiting for approval.</p>
          )}
          {waiting.map((w) => (
            <div className="waiting-item" key={w.id}>
              <div className="row spread">
                <strong>{w.productTitle}</strong>
                <span className="mono">{fmt(w.amountCents)}</span>
              </div>
              <p className="muted" style={{ margin: "0.4rem 0" }}>
                {w.policyReason}. {w.agentReasoning}
              </p>
              <div className="row">
                <button disabled={busy} onClick={() => decide(w.id, "approve")}>
                  Approve
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => decide(w.id, "reject")}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {msg && <div className="notice">{msg}</div>}
        </section>

        <aside>
          <div className="card">
            <div className="muted mono">POLICY</div>
            <form className="policy-form" onSubmit={save}>
              <div>
                <label htmlFor="cap">Monthly cap ($)</label>
                <input
                  id="cap"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthlyCap}
                  onChange={(e) =>
                    setForm({ ...form, monthlyCap: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <label htmlFor="max">Per-purchase max ($)</label>
                <input
                  id="max"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.perPurchaseMax}
                  onChange={(e) =>
                    setForm({ ...form, perPurchaseMax: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <label htmlFor="auto">Auto-approve under ($)</label>
                <input
                  id="auto"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.autoApproveUnder}
                  onChange={(e) =>
                    setForm({ ...form, autoApproveUnder: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <label htmlFor="blocked">
                  Blocked categories (comma separated)
                </label>
                <input
                  id="blocked"
                  value={form.blockedCategories}
                  onChange={(e) =>
                    setForm({ ...form, blockedCategories: e.target.value })
                  }
                  placeholder="e.g. gift cards"
                />
              </div>
              <button type="submit" disabled={busy}>
                Save policy
              </button>
            </form>
          </div>
        </aside>
      </div>
    </main>
  );
}
