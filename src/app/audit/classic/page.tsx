"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type RowClickedEvent,
} from "ag-grid-community";
import { PufferGauge, STATE_LABELS, stateForRatio } from "@/components/PufferGauge";
import { StatusBadge } from "@/components/StatusBadge";
import {
  applyAuditFilters,
  filterLabel,
  type AuditFilter,
  type AuditQuerySpec,
} from "@/lib/audit-filters";
import {
  consumePuffFlag,
  fmtDollars,
  fmtWhole,
  friendlyClientError,
  isRateLimitMsg,
} from "@/lib/ui";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Row {
  id: number;
  createdAt: string;
  productTitle: string;
  merchantUrl: string | null;
  category: string | null;
  amountCents: number;
  status: string;
  policyDecision: string;
  policyReason: string;
  agentReasoning: string | null;
  decidedBy: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  errorMessage: string | null;
}

type Filter = AuditFilter;
type QuerySpec = AuditQuerySpec;

const MONTH = new Date().toLocaleString("en-US", { month: "long" }).toUpperCase();

const CHIPS = [
  "blocked this week",
  "total spent this month",
  "waiting for approval",
];

function shortTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short" });
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${h}:${m}`;
}

const COLS: ColDef<Row>[] = [
  {
    headerName: "Time",
    field: "createdAt",
    width: 110,
    sort: "desc",
    cellRenderer: (p: { value?: string }) =>
      p.value ? (
        <span title={new Date(p.value).toLocaleString()}>
          {shortTime(p.value)}
        </span>
      ) : null,
  },
  {
    headerName: "Item",
    field: "productTitle",
    flex: 1.4,
    minWidth: 160,
    filter: "agTextColumnFilter",
    cellRenderer: (p: { data?: Row }) =>
      p.data?.merchantUrl ? (
        <a href={p.data.merchantUrl} target="_blank" rel="noreferrer">
          {p.data.productTitle}
        </a>
      ) : (
        p.data?.productTitle
      ),
  },
  {
    headerName: "Amount",
    field: "amountCents",
    width: 100,
    filter: "agNumberColumnFilter",
    cellStyle: { textAlign: "right" },
    valueFormatter: (p) => fmtDollars(p.value),
  },
  {
    headerName: "Status",
    field: "status",
    width: 150,
    filter: "agTextColumnFilter",
    cellRenderer: (p: { value?: string }) =>
      p.value ? <StatusBadge status={p.value} /> : null,
  },
  {
    headerName: "Decided by",
    field: "decidedBy",
    width: 100,
    valueFormatter: (p) => (p.value === "owner" ? "you" : p.value),
  },
  { headerName: "Reason", field: "policyReason", flex: 1.2, minWidth: 140 },
  {
    headerName: "Agent reasoning",
    field: "agentReasoning",
    flex: 2,
    minWidth: 200,
    cellStyle: {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    valueFormatter: (p) => p.value ?? "",
  },
];

// Theme params resolve CSS vars at render time, so the classic grid follows
// the same tokens as the rest of the app.
const theme = themeQuartz.withParams({
  backgroundColor: "var(--card)",
  foregroundColor: "var(--ink)",
  borderColor: "var(--line)",
  chromeBackgroundColor: "var(--card)",
  headerBackgroundColor: "var(--paper)",
  accentColor: "var(--tide)",
  rowHoverColor: "var(--ocean-soft)",
  fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif",
  headerFontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif",
  headerFontSize: 11,
  headerFontWeight: 700,
  fontSize: 14,
  rowHeight: 56,
  headerHeight: 44,
  borderRadius: 18,
  oddRowBackgroundColor: "var(--card)",
});

export default function AuditPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [budget, setBudget] = useState<{
    spentCents: number;
    capCents: number;
    ratio: number;
  } | null>(null);
  const [blockedAt, setBlockedAt] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<QuerySpec["sort"]>(null);
  const [summary, setSummary] = useState<QuerySpec["summary"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const cache = useRef(new Map<string, QuerySpec>());

  const load = useCallback(async () => {
    const [p, b] = await Promise.all([
      fetch("/api/purchases").then((r) => r.json()).catch(() => null),
      fetch("/api/budget").then((r) => r.json()).catch(() => null),
    ]);
    if (p?.purchases) setRows(p.purchases);
    if (b?.capCents != null) setBudget(b);
  }, []);

  useEffect(() => {
    setBlockedAt(consumePuffFlag());
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Esc closes the detail drawer
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const cached = cache.current.get(text.toLowerCase());
    if (cached) {
      setFilters(cached.filters);
      setSort(cached.sort);
      setSummary(cached.summary);
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/audit/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 422) {
          throw new Error(
            "I could not turn that into a filter. Try: show blocked purchases this week."
          );
        }
        throw new Error(data.error || "query failed");
      }
      const spec = data as QuerySpec;
      cache.current.set(text.toLowerCase(), spec);
      setFilters(spec.filters);
      setSort(spec.sort);
      setSummary(spec.summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        isRateLimitMsg(msg)
          ? "Puffr is catching its breath. Try again in a minute."
          : friendlyClientError(msg)
      );
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () => applyAuditFilters(rows ?? [], filters, sort),
    [rows, filters, sort]
  );

  const summaryText = useMemo(() => {
    if (!summary) return null;
    if (summary.type === "count") return `${filtered.length} rows`;
    const total = filtered.reduce((s, r) => s + r.amountCents, 0);
    return `${filtered.length} rows - ${fmtDollars(total)} total`;
  }, [filtered, summary]);

  const cols = COLS;

  const pct = budget ? Math.round(budget.ratio * 100) : 0;
  const state = budget ? stateForRatio(budget.ratio) : "calm";

  return (
    <main className="page">
      <div className="audit-layout">
        <aside className="audit-panel">
          <div className="side-title">ALLOWANCE - {MONTH}</div>
          {budget ? (
            <div className="gauge-block">
              <PufferGauge
                ratio={budget.ratio}
                size={220}
                showLabel
                blockedAt={blockedAt}
              />
              <div className="gauge-amount">
                {fmtWhole(budget.spentCents)} of {fmtWhole(budget.capCents)}
              </div>
              <div className="gauge-state">
                {pct}% — {STATE_LABELS[state]}
              </div>
            </div>
          ) : (
            <p className="muted">Loading...</p>
          )}
          <hr className="divider" />
          <div className="side-title">Fish states</div>
          <div className="legend">
            <div className="row"><span>0-50%</span><span className="muted">Calm</span></div>
            <div className="row"><span>50-80%</span><span className="muted">Swelling</span></div>
            <div className="row"><span>80-99%</span><span className="muted">Puffed</span></div>
            <div className="row"><span>100%</span><span className="muted">Maxed out</span></div>
          </div>
        </aside>

        <section className="audit-main">
          <div>
            <label htmlFor="audit-q">Ask the audit log</label>
            <form
              className="ask-row"
              onSubmit={(e) => {
                e.preventDefault();
                ask();
              }}
            >
              <input
                id="audit-q"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. show everything the agent blocked this week"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !question.trim()}>
                {busy ? "Thinking..." : "Ask"}
              </button>
              {(filters.length > 0 || question) && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setFilters([]);
                    setSort(null);
                    setSummary(null);
                    setQuestion("");
                    setError(null);
                  }}
                >
                  Clear
                </button>
              )}
            </form>
            <div className="ask-chips">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  className="chip"
                  onClick={() => {
                    setQuestion(c);
                    ask(c);
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            {filters.length > 0 && (
              <div className="applied">
                <span className="lbl">Applied:</span>
                {filters.map((f, i) => (
                  <span className="filter-chip" key={i}>
                    {filterLabel(f)}
                    <button
                      aria-label={`Remove filter ${filterLabel(f)}`}
                      onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {summaryText && <div className="audit-summary">{summaryText}</div>}
            {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
          </div>

          <div className="grid-wrap">
            {rows === null ? (
              <p className="empty-note" style={{ padding: 24 }}>
                Loading...
              </p>
            ) : (
              <AgGridReact<Row>
                theme={theme}
                rowData={filtered}
                columnDefs={cols}
                defaultColDef={{ sortable: true, resizable: true }}
                onRowClicked={(e: RowClickedEvent<Row>) => {
                  const t = e.event?.target as HTMLElement | undefined;
                  if (t?.closest("a")) return;
                  setDetail((d) => (d?.id === e.data?.id ? null : e.data ?? null));
                }}
                localeText={{
                  noRowsToShow:
                    rows.length === 0
                      ? "Nothing yet. Ask Puffr to buy something."
                      : "No rows match the current filters.",
                }}
              />
            )}
          </div>
        </section>
      </div>

      {detail && (
        <aside className="drawer" aria-label="Purchase details">
          <div className="row spread">
            <h2>Details</h2>
            <button
              className="text"
              aria-label="Close details"
              onClick={() => setDetail(null)}
              style={{ fontSize: 22 }}
            >
              ×
            </button>
          </div>
          <div className="d-row">
            <span className="k">Item</span>
            {detail.merchantUrl ? (
              <a href={detail.merchantUrl} target="_blank" rel="noreferrer">
                {detail.productTitle}
              </a>
            ) : (
              detail.productTitle
            )}
          </div>
          <div className="d-row">
            <span className="k">Time</span>
            {new Date(detail.createdAt).toLocaleString()}
          </div>
          <div className="d-row">
            <span className="k">Amount</span>
            {fmtDollars(detail.amountCents)}
          </div>
          <div className="d-row">
            <span className="k">Status</span>
            <StatusBadge status={detail.status} />
          </div>
          <div className="d-row">
            <span className="k">Decided by</span>
            {detail.decidedBy === "owner" ? "you" : "policy"}
          </div>
          <div className="d-row">
            <span className="k">Policy decision</span>
            {detail.policyDecision} — {detail.policyReason}
          </div>
          <div className="d-row">
            <span className="k">Agent reasoning</span>
            {detail.agentReasoning ?? "—"}
          </div>
          {detail.paypalOrderId && (
            <div className="d-row">
              <span className="k">PayPal order</span>
              <span className="mono">{detail.paypalOrderId}</span>
            </div>
          )}
          {detail.paypalCaptureId && (
            <div className="d-row">
              <span className="k">PayPal capture</span>
              <span className="mono">{detail.paypalCaptureId}</span>
            </div>
          )}
          {detail.errorMessage && (
            <div className="d-row">
              <span className="k">Error</span>
              {/* DB error text can contain provider output — show only clean reasons */}
              {/^blocked on re-check/i.test(detail.errorMessage)
                ? detail.errorMessage
                : "The payment did not complete in the sandbox."}
            </div>
          )}
        </aside>
      )}
    </main>
  );
}
