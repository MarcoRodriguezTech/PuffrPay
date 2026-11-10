// Maps the validated audit-query spec (POST /api/audit/query) onto AG Studio
// page-level filters, so a question like "blocked this week" filters every
// widget on the Activity dashboard. Chips map 1:1 to spec filters; removing a
// chip rebuilds the filter list without another LLM call.

import type { AgFilterState, AgSortConfig } from "ag-studio";
import {
  applyAuditFilters,
  monthStart,
  weekStart,
  type AuditFilter,
  type AuditQuerySpec,
  type FilterableRow,
} from "@/lib/audit-filters";

const STUDIO_FIELD: Record<string, string> = {
  created_at: "requests.createdAt",
  product_title: "requests.title",
  category: "requests.category",
  amount_cents: "requests.amount",
  status: "requests.status",
  policy_reason: "requests.reason",
  agent_reasoning: "requests.reasoning",
  decided_by: "requests.decidedBy",
};

const STUDIO_OP: Record<string, string> = {
  eq: "equals",
  neq: "notEqual",
  gt: "greaterThan",
  gte: "greaterThanOrEqual",
  lt: "lessThan",
  lte: "lessThanOrEqual",
  contains: "contains",
};

function toStudio(f: AuditFilter): AgFilterState | null {
  const id = STUDIO_FIELD[f.field];
  if (!id) return null;

  let operator = STUDIO_OP[f.operator] ?? "equals";
  let value: unknown = f.value;

  if (f.field === "created_at") {
    // 'week'/'month' are relative shorthands — resolve to absolute dates.
    if (f.value === "week") {
      operator = "greaterThanOrEqual";
      value = weekStart().toISOString();
    } else if (f.value === "month") {
      operator = "greaterThanOrEqual";
      value = monthStart().toISOString();
    }
  } else if (f.field === "amount_cents") {
    // The spec works in cents; the Studio field holds dollars.
    value = Number(f.value) / 100;
  }

  return {
    field: { id },
    model: { operator: operator as never, value },
  } as AgFilterState;
}

export function specToStudioFilters(filters: AuditFilter[]): AgFilterState[] {
  return filters.map(toStudio).filter((f): f is AgFilterState => f !== null);
}

export function specToGridSort(sort: AuditQuerySpec["sort"]): AgSortConfig[] | undefined {
  if (!sort) return undefined;
  const id = STUDIO_FIELD[sort.field];
  if (!id) return undefined;
  return [{ field: { id }, direction: sort.direction }];
}

// Summary line ("3 rows - $187.00 total") evaluated over the same flat rows
// Studio reports on, so it agrees with what the widgets show.
export function specSummary(
  spec: AuditQuerySpec,
  rows: FilterableRow[]
): { text: string; count: number } | null {
  const filtered = applyAuditFilters(rows, spec.filters, spec.sort);
  if (!spec.summary) return { text: `${filtered.length} rows`, count: filtered.length };
  if (spec.summary.type === "count")
    return { text: `${filtered.length} rows`, count: filtered.length };
  const totalCents = filtered.reduce((s, r) => s + (r.amountCents ?? 0), 0);
  return {
    text: `${filtered.length} rows - $${(totalCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total`,
    count: filtered.length,
  };
}
