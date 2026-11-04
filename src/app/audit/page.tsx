"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { PufferGauge } from "@/components/PufferGauge";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Row {
  id: number;
  createdAt: string;
  productTitle: string;
  merchantUrl: string | null;
  category: string | null;
  amountCents: number;
  status: string;
  policyReason: string;
  agentReasoning: string | null;
  decidedBy: string;
  paypalOrderId: string | null;
}

interface QuerySpec {
  filters: { field: string; operator: string; value: string }[];
  sort: { field: string; direction: "asc" | "desc" } | null;
  summary: { type: "count" | "sum"; field?: string } | null;
  understood: string;
}

const FIELD_MAP: Record<string, keyof Row> = {
  created_at: "createdAt",
  product_title: "productTitle",
  category: "category",
  amount_cents: "amountCents",
  status: "status",
  policy_reason: "policyReason",
  agent_reasoning: "agentReasoning",
  decided_by: "decidedBy",
};

function weekStart(): Date {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

function monthStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function applySpec(rows: Row[], spec: QuerySpec | null): Row[] {
  if (!spec) return rows;
  let out = rows;
  for (const f of spec.filters) {
    const key = FIELD_MAP[f.field];
    if (!key) continue;
    out = out.filter((r) => {
      const raw = r[key];
      // relative date shorthands produced by the LLM schema
      if (f.field === "created_at" && (f.value === "week" || f.value === "month")) {
        const since = f.value === "week" ? weekStart() : monthStart();
        return new Date(raw as string) >= since;
      }
      if (f.field === "created_at") {
        const a = new Date(raw as string).getTime();
        const b = new Date(f.value).getTime();
        if (Number.isNaN(b)) return true;
        return cmp(a, b, f.operator);
      }
      if (f.field === "amount_cents") {
        const n = Number(f.value);
        return cmp(raw as number, n, f.operator);
      }
      const s = String(raw ?? "").toLowerCase();
      const v = f.value.toLowerCase();
      switch (f.operator) {
        case "eq": return s === v;
        case "neq": return s !== v;
        case "contains": return s.includes(v);
        default: return s === v;
      }
    });
  }
  if (spec.sort) {
    const key = FIELD_MAP[spec.sort.field];
    if (key) {
      const dir = spec.sort.direction === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a[key], bv = b[key];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av > bv ? 1 : -1) * dir;
      });
    }
  }
  return out;
}

function cmp(a: number, b: number, op: string): boolean {
  switch (op) {
    case "eq": return a === b;
    case "neq": return a !== b;
    case "gt": return a > b;
    case "gte": return a >= b;
    case "lt": return a < b;
    case "lte": return a <= b;
    default: return a === b;
  }
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [budget, setBudget] = useState<{
    spentCents: number;
    capCents: number;
    ratio: number;
  } | null>(null);
  const [question, setQuestion] = useState("");
  const [spec, setSpec] = useState<QuerySpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, b] = await Promise.all([
      fetch("/api/purchases").then((r) => r.json()).catch(() => null),
      fetch("/api/budget").then((r) => r.json()).catch(() => null),
    ]);
    if (p?.purchases) setRows(p.purchases);
    if (b?.capCents != null) setBudget(b);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/audit/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "query failed");
      setSpec(data);
    } catch (err) {
      setSpec(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => applySpec(rows, spec), [rows, spec]);

  const summaryText = useMemo(() => {
    if (!spec?.summary) return null;
    if (spec.summary.type === "count") return `${filtered.length} request(s)`;
    const total = filtered.reduce((s, r) => s + r.amountCents, 0);
    return `Total: ${fmt(total)} across ${filtered.length} request(s)`;
  }, [filtered, spec]);

  const cols = useMemo<ColDef<Row>[]>(
    () => [
      {
        headerName: "Time",
        field: "createdAt",
        width: 150,
        valueFormatter: (p) => new Date(p.value).toLocaleString(),
        sort: "desc",
      },
      {
        headerName: "Item",
        field: "productTitle",
        flex: 1,
        minWidth: 180,
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
        headerName: "Category",
        field: "category",
        width: 110,
        valueFormatter: (p) => p.value ?? "—",
      },
      {
        headerName: "Amount",
        field: "amountCents",
        width: 100,
        valueFormatter: (p) => fmt(p.value),
      },
      {
        headerName: "Status",
        field: "status",
        width: 120,
        cellRenderer: (p: { value?: string }) =>
          p.value ? <span className={`chip ${p.value}`}>{p.value}</span> : null,
      },
      { headerName: "Policy reason", field: "policyReason", width: 190 },
      {
        headerName: "Agent reasoning",
        field: "agentReasoning",
        flex: 1,
        minWidth: 200,
        valueFormatter: (p) => p.value ?? "",
        tooltipField: "agentReasoning",
      },
      { headerName: "Decided by", field: "decidedBy", width: 110 },
      {
        headerName: "PayPal",
        field: "paypalOrderId",
        width: 170,
        valueFormatter: (p) => p.value ?? "—",
      },
    ],
    []
  );

  return (
    <main className="page">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 300 }}>
          {budget && (
            <PufferGauge
              ratio={budget.ratio}
              spentCents={budget.spentCents}
              capCents={budget.capCents}
              size={130}
            />
          )}
        </div>
        <div style={{ flex: 2, minWidth: 300 }}>
          <label htmlFor="q">Ask about the audit log (plain English)</label>
          <div className="row">
            <input
              id="q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder="show everything the agent blocked this week"
              disabled={busy}
            />
            <button onClick={ask} disabled={busy}>
              Ask
            </button>
          </div>
          {spec && (
            <div className="audit-summary">
              Understood: {spec.understood}
              {spec.summary ? "" : " — showing filtered rows below"}
              <button
                className="secondary"
                style={{ marginLeft: "0.75rem", padding: "0.1rem 0.5rem" }}
                onClick={() => {
                  setSpec(null);
                  setQuestion("");
                }}
              >
                Clear
              </button>
            </div>
          )}
          {summaryText && <div className="audit-summary">{summaryText}</div>}
          {error && <div className="error">{error}</div>}
        </div>
      </div>

      <div className="grid-wrap" style={{ marginTop: "1rem" }}>
        <AgGridReact<Row>
          theme={themeQuartz}
          rowData={filtered}
          columnDefs={cols}
          defaultColDef={{
            sortable: true,
            filter: true,
            resizable: true,
          }}
          pagination={true}
          paginationPageSize={15}
          animateRows={true}
        />
      </div>
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Filters and sort from your question are applied on top of the grid —
        columns stay sortable/filterable by hand too.
      </p>
    </main>
  );
}
