"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flagPuffNextLoad,
  fmtDollars,
  fmtWhole,
  friendlyClientError,
  refreshBudget,
  storeOf,
  toast,
} from "@/lib/ui";

interface Purchase {
  id: number;
  createdAt: string;
  productTitle: string;
  merchantUrl: string | null;
  amountCents: number;
  status: string;
  policyDecision: string;
  policyReason: string;
  agentReasoning: string | null;
  paypalOrderId: string | null;
  errorMessage: string | null;
}

interface Policy {
  monthlyCapCents: number;
  perPurchaseMaxCents: number;
  autoApproveUnderCents: number;
  blockedCategories: string[];
}

const toDollars = (c: number) => (c / 100).toFixed(2);

/** dollars string -> cents, or null when malformed */
function parseDollars(s: string): number | null {
  const t = s.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

const HELPERS = {
  monthlyCap: "The most the agent can spend in a calendar month.",
  perPurchaseMax: "The most for any single purchase.",
  autoApproveUnder:
    "Purchases at or under this amount are bought without asking you.",
};

export default function PolicyPage() {
  const [form, setForm] = useState({ cap: "", max: "", auto: "" });
  const [cats, setCats] = useState<string[]>([]);
  const [catInput, setCatInput] = useState("");
  const [baseline, setBaseline] = useState<{
    cap: string;
    max: string;
    auto: string;
    cats: string[];
  } | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [waiting, setWaiting] = useState<Purchase[] | null>(null);
  const [cardBusy, setCardBusy] = useState<number | null>(null);
  const [cardErr, setCardErr] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const [p, w] = await Promise.all([
      fetch("/api/policy").then((r) => r.json()).catch(() => null),
      fetch("/api/purchases?status=WAITING").then((r) => r.json()).catch(() => null),
    ]);
    if (p?.monthlyCapCents != null) {
      const next = {
        cap: toDollars(p.monthlyCapCents),
        max: toDollars(p.perPurchaseMaxCents),
        auto: toDollars(p.autoApproveUnderCents),
      };
      setForm(next);
      setCats(p.blockedCategories);
      setBaseline({ ...next, cats: p.blockedCategories });
    }
    if (w?.purchases) {
      setWaiting(
        w.purchases.filter(
          (x: Purchase) => x.policyDecision === "ASK" && !x.paypalOrderId
        )
      );
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const errors = useMemo(() => {
    const e: { cap?: string; max?: string; auto?: string } = {};
    const cap = parseDollars(form.cap);
    const max = parseDollars(form.max);
    const auto = parseDollars(form.auto);
    if (cap == null || cap <= 0) e.cap = "Enter an amount greater than $0.";
    if (max == null || max <= 0) e.max = "Enter an amount greater than $0.";
    if (auto == null || auto <= 0) e.auto = "Enter an amount greater than $0.";
    if (!e.max && !e.cap && (max as number) > (cap as number))
      e.max = "Per-purchase max must be less than or equal to the monthly cap.";
    if (!e.auto && !e.max && (auto as number) > (max as number))
      e.auto = "Auto-approve must be less than or equal to the per-purchase max.";
    return e;
  }, [form]);

  const dirty = useMemo(() => {
    if (!baseline) return false;
    return (
      form.cap !== baseline.cap ||
      form.max !== baseline.max ||
      form.auto !== baseline.auto ||
      cats.join("\n") !== baseline.cats.join("\n")
    );
  }, [form, cats, baseline]);

  const valid = Object.keys(errors).length === 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || !dirty || saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch("/api/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyCapCents: parseDollars(form.cap),
          perPurchaseMaxCents: parseDollars(form.max),
          autoApproveUnderCents: parseDollars(form.auto),
          blockedCategories: cats,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setBaseline({ ...form, cats });
      setTouched(false);
      setSavedAt(Date.now());
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedAt(0), 2000);
      toast("Rules saved.");
      refreshBudget();
    } catch (err) {
      setSaveErr(friendlyClientError(err));
    } finally {
      setSaving(false);
    }
  }

  function addCat() {
    const c = catInput.trim();
    if (c && !cats.some((x) => x.toLowerCase() === c.toLowerCase())) {
      setCats([...cats, c]);
    }
    setCatInput("");
  }

  async function decide(p: Purchase, action: "approve" | "reject") {
    if (cardBusy) return;
    setCardBusy(p.id);
    setCardErr((e) => ({ ...e, [p.id]: "" }));
    try {
      const res = await fetch(`/api/purchases/${p.id}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      const updated: Purchase = data.purchase;
      setWaiting((w) => (w ?? []).filter((x) => x.id !== p.id));
      if (action === "reject") {
        toast("Rejected");
      } else if (updated.status === "PURCHASED") {
        toast("Payment sent (sandbox)");
      } else if (updated.status === "BLOCKED") {
        flagPuffNextLoad();
        const reason = (updated.errorMessage ?? updated.policyReason).replace(
          /^blocked on re-check:\s*/i,
          ""
        );
        toast(`Blocked on re-check: ${reason}`);
      } else if (data.approveUrl) {
        window.open(data.approveUrl, "_blank", "noreferrer");
        toast("Payment started — approve it in the PayPal tab.");
      }
      refreshBudget();
    } catch (err) {
      setCardErr((e) => ({ ...e, [p.id]: friendlyClientError(err) }));
    } finally {
      setCardBusy(null);
    }
  }

  const capC = parseDollars(form.cap) ?? 0;
  const maxC = parseDollars(form.max) ?? 0;
  const autoC = parseDollars(form.auto) ?? 0;
  const nudge = (key: "cap" | "max" | "auto", delta: number) => {
    setTouched(true);
    const cur = parseDollars(form[key]) ?? 0;
    setForm({ ...form, [key]: toDollars(Math.max(0, cur + delta)) });
  };

  return (
    <main className="page">
      <div className="policy-layout">
        <section>
          <h2>POLICY</h2>

          <RulesRuler cap={capC} max={maxC} auto={autoC} />
          <TryIt />

          <form className="policy-form" onSubmit={save}>
            <MoneyField
              id="cap"
              label="Monthly cap"
              value={form.cap}
              helper={HELPERS.monthlyCap}
              error={touched ? errors.cap : undefined}
              onStep={(d) => nudge("cap", d * 1000)}
              onChange={(v) => {
                setTouched(true);
                setForm({ ...form, cap: v });
              }}
            />
            <MoneyField
              id="max"
              label="Per-purchase max"
              value={form.max}
              helper={HELPERS.perPurchaseMax}
              error={touched ? errors.max : undefined}
              onStep={(d) => nudge("max", d * 1000)}
              onChange={(v) => {
                setTouched(true);
                setForm({ ...form, max: v });
              }}
            />
            <MoneyField
              id="auto"
              label="Auto-approve under"
              value={form.auto}
              helper={HELPERS.autoApproveUnder}
              error={touched ? errors.auto : undefined}
              onStep={(d) => nudge("auto", d * 500)}
              onChange={(v) => {
                setTouched(true);
                setForm({ ...form, auto: v });
              }}
            />

            <div className="field">
              <label htmlFor="cats">Blocked categories</label>
              <input
                id="cats"
                value={catInput}
                onChange={(e) => setCatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCat();
                  }
                }}
                placeholder="type and press Enter"
              />
              {cats.length > 0 && (
                <div className="tags">
                  {cats.map((c) => (
                    <span className="tag-chip" key={c}>
                      {c}
                      <button
                        type="button"
                        aria-label={`Remove ${c}`}
                        onClick={() => setCats(cats.filter((x) => x !== c))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {saveErr && <div className="error">{saveErr}</div>}
            <div>
              <button type="submit" disabled={!valid || !dirty || saving}>
                {saving ? (
                  <span className="spinner" aria-hidden="true" />
                ) : savedAt ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M2 6.5 5 9.5 10 3" />
                    </svg>
                    Saved
                  </>
                ) : (
                  "Save rules"
                )}
              </button>
            </div>
          </form>
        </section>

        <section className="policy-queue">
          <h2>WAITING FOR YOU ({waiting?.length ?? 0})</h2>
          {waiting === null && <p className="empty-note">Loading...</p>}
          {waiting?.length === 0 && (
            <p className="empty-note">
              Nothing waiting. Puffr will ask here when a purchase needs you.
            </p>
          )}
          <div className="queue-grid">
            {waiting?.map((w) => (
              <div className="wait-card" key={w.id}>
              <div className="title-row">
                <strong>{w.productTitle}</strong>
                <span className="amount">{fmtDollars(w.amountCents)}</span>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                {w.policyReason}
              </div>
              {w.agentReasoning && (
                <div style={{ marginTop: 4 }}>
                  <span className={expanded.has(w.id) ? "" : "clamp3"}>
                    <strong>Agent:</strong>{" "}
                    <span className="muted">{w.agentReasoning}</span>
                  </span>
                  {w.agentReasoning.length > 140 && (
                    <button
                      className="text"
                      onClick={() =>
                        setExpanded((s) => {
                          const n = new Set(s);
                          if (n.has(w.id)) {
                            n.delete(w.id);
                          } else {
                            n.add(w.id);
                          }
                          return n;
                        })
                      }
                    >
                      {expanded.has(w.id) ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              )}
              {w.merchantUrl && (
                <div style={{ marginTop: 4 }}>
                  <a href={w.merchantUrl} target="_blank" rel="noreferrer">
                    View product ({storeOf(w.merchantUrl)})
                  </a>
                </div>
              )}
              {cardErr[w.id] && (
                <div className="card-err">
                  {cardErr[w.id]}
                  <button
                    className="text"
                    onClick={() => decide(w, "approve")}
                  >
                    Retry
                  </button>
                </div>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  onClick={() => decide(w, "approve")}
                  disabled={cardBusy === w.id}
                >
                  {cardBusy === w.id && (
                    <span className="spinner" aria-hidden="true" />
                  )}
                  Approve
                </button>
                <button
                  className="secondary danger"
                  onClick={() => decide(w, "reject")}
                  disabled={cardBusy === w.id}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function MoneyField({
  id,
  label,
  value,
  helper,
  error,
  onChange,
  onStep,
}: {
  id: string;
  label: string;
  value: string;
  helper: string;
  error?: string;
  onChange: (v: string) => void;
  onStep?: (delta: number) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="money">
        <span aria-hidden="true">$</span>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : `${id}-help`}
        />
        {onStep && (
          <span className="step">
            <button
              type="button"
              aria-label={`Increase ${label}`}
              onClick={() => onStep(1)}
            >
              +
            </button>
            <button
              type="button"
              aria-label={`Decrease ${label}`}
              onClick={() => onStep(-1)}
            >
              −
            </button>
          </span>
        )}
      </div>
      {error ? (
        <div className="err" id={`${id}-err`}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 2v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            <circle cx="6" cy="9.6" r="0.9" fill="currentColor" />
          </svg>
          {error}
        </div>
      ) : (
        <div className="helper" id={`${id}-help`}>
          {helper}
        </div>
      )}
    </div>
  );
}

/** Live bar showing the three rule zones across $0..cap. */
function RulesRuler({
  cap,
  max,
  auto,
}: {
  cap: number;
  max: number;
  auto: number;
}) {
  if (cap <= 0) return null;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / cap) * 100));
  const autoPct = pct(auto);
  const maxPct = pct(max);
  const zones = [
    { w: autoPct, cls: "auto", label: "Buys on its own" },
    { w: Math.max(0, maxPct - autoPct), cls: "ask", label: "Asks you" },
    { w: Math.max(0, 100 - maxPct), cls: "block", label: "Blocked" },
  ];
  const marks = [
    { at: 0, v: "$0", cls: "first" },
    { at: autoPct, v: fmtWhole(auto), cls: "" },
    { at: maxPct, v: fmtWhole(max), cls: "" },
    { at: 100, v: fmtWhole(cap), cls: "last" },
  ];
  return (
    <div className="rules-ruler" aria-hidden="true">
      <div className="bar">
        {zones.map((z) => (
          <div key={z.cls} className={`seg ${z.cls}`} style={{ width: `${z.w}%` }} />
        ))}
      </div>
      <div className="marks">
        {marks.map((m, i) => (
          <span key={i} className={`mark ${m.cls}`} style={{ left: `${m.at}%` }}>
            {m.v}
          </span>
        ))}
      </div>
      <div className="zone-labels">
        {zones.map((z) => (
          <span key={z.cls} className="zone-key">
            <i className={`swatch ${z.cls}`} aria-hidden="true" />
            {z.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const VERDICT: Record<string, { cls: string; icon: string; label: string }> = {
  ALLOW: { cls: "allow", icon: "✓", label: "ALLOW" },
  ASK: { cls: "ask", icon: "?", label: "ASK" },
  BLOCK: { cls: "block", icon: "✗", label: "BLOCK" },
};

/** "Would this be allowed?" dry-run against the real policy engine. */
function TryIt() {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ decision: string; reason: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function simulate() {
    const amountCents = parseDollars(amount);
    if (amountCents == null || amountCents <= 0 || busy) {
      setErr("Enter an amount greater than $0.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/policy/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, category: category.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "simulate failed");
      setResult(data);
    } catch (e) {
      setErr(friendlyClientError(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const v = result ? VERDICT[result.decision] : null;

  return (
    <div className="tryit">
      <div className="row">
        <div>
          <label htmlFor="try-amount">Amount</label>
          <div className="money" style={{ width: 140 }}>
            <span aria-hidden="true">$</span>
            <input
              id="try-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25.00"
            />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor="try-cat">Category</label>
          <input
            id="try-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="optional"
          />
        </div>
        <button type="button" className="secondary" onClick={simulate} disabled={busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          Would this be allowed?
        </button>
      </div>
      {err && <div className="card-err">{err}</div>}
      {v && (
        <div className="verdict">
          <span className={`verdict-chip ${v.cls}`}>
            <span aria-hidden="true">{v.icon}</span> {v.label}
          </span>
          <span className="muted">{result?.reason}</span>
        </div>
      )}
    </div>
  );
}
