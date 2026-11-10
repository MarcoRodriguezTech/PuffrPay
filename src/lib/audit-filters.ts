// Shared logic for the natural-language audit query: the validated filter spec
// returned by POST /api/audit/query, chip labels, and a client-side evaluator
// that applies the spec to rows. Used by the classic audit grid and by the
// Activity ask box (which also maps the spec onto Studio page filters).

export interface AuditFilter {
  field: string;
  operator: string;
  value: string;
}

export interface AuditQuerySpec {
  filters: AuditFilter[];
  sort: { field: string; direction: "asc" | "desc" } | null;
  summary: { type: "count" | "sum"; field?: string } | null;
  understood: string;
}

import { statusLabel } from "./status";

const OP_SYM: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
};

const fmtDollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function filterLabel(f: AuditFilter): string {
  if (f.field === "created_at" && f.value === "week") return "last 7 days";
  if (f.field === "created_at" && f.value === "month") return "this month";
  if (f.field === "status") return `status = ${statusLabel(f.value) ?? f.value}`;
  if (f.field === "decided_by")
    return `decided by = ${f.value === "owner" ? "you" : f.value}`;
  if (f.field === "amount_cents")
    return `amount ${OP_SYM[f.operator] ?? f.operator} ${fmtDollars(Number(f.value))}`;
  return `${f.field.replace(/_/g, " ")} ${OP_SYM[f.operator] ?? f.operator} ${f.value}`;
}

export function weekStart(): Date {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

export function monthStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function cmp(a: number, b: number, op: string): boolean {
  switch (op) {
    case "neq": return a !== b;
    case "gt": return a > b;
    case "gte": return a >= b;
    case "lt": return a < b;
    case "lte": return a <= b;
    default: return a === b;
  }
}

// Minimal shape every row source must satisfy — audit grid rows and the flat
// Studio `requests` rows both fit it.
export interface FilterableRow {
  createdAt: string;
  productTitle?: string | null;
  category?: string | null;
  amountCents?: number;
  status?: string;
  policyReason?: string;
  agentReasoning?: string | null;
  decidedBy?: string;
}

const FIELD_KEY: Record<string, keyof FilterableRow> = {
  created_at: "createdAt",
  product_title: "productTitle",
  category: "category",
  amount_cents: "amountCents",
  status: "status",
  policy_reason: "policyReason",
  agent_reasoning: "agentReasoning",
  decided_by: "decidedBy",
};

export function applyAuditFilters<T extends FilterableRow>(
  rows: T[],
  filters: AuditFilter[],
  sort: AuditQuerySpec["sort"]
): T[] {
  let out = rows;
  for (const f of filters) {
    const key = FIELD_KEY[f.field];
    if (!key) continue;
    out = out.filter((r) => {
      const raw = r[key];
      if (f.field === "created_at" && (f.value === "week" || f.value === "month")) {
        const since = f.value === "week" ? weekStart() : monthStart();
        return new Date(raw as string) >= since;
      }
      if (f.field === "created_at") {
        const b = new Date(f.value).getTime();
        if (Number.isNaN(b)) return true;
        return cmp(new Date(raw as string).getTime(), b, f.operator);
      }
      if (f.field === "amount_cents") {
        return cmp(raw as number, Number(f.value), f.operator);
      }
      const s = String(raw ?? "").toLowerCase();
      const v = f.value.toLowerCase();
      switch (f.operator) {
        case "neq": return s !== v;
        case "contains": return s.includes(v);
        default: return s === v;
      }
    });
  }
  if (sort) {
    const key = FIELD_KEY[sort.field];
    if (key) {
      const dir = sort.direction === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a[key] as unknown, bv = b[key] as unknown;
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av > bv ? 1 : -1) * dir;
      });
    }
  }
  return out;
}
