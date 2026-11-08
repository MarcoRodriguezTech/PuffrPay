"use client";

// Custom cell renderers for the Studio grid widget, wired through the 'grid'
// widget definition's `options.createCellRenderer` (see activity.tsx). They
// only claim the columns they recognise; every other field keeps Studio's
// default rendering.

import { createContext, useContext, type ComponentType } from "react";
import type { AgWidgetField } from "ag-studio";
import type { CustomCellRendererProps } from "ag-grid-react";
import type { DashboardData } from "@/lib/dashboard-data";
import { OptBadge, StatusBadge } from "@/components/StatusBadge";

type Row = DashboardData["activity"][number];

// The footer totals come from the full dashboard rows (matching the KPI
// tiles), not the grid's aggregation — pagination and filters must not shrink
// "Total bought" / "Total requested". activity.tsx provides the rows.
export const DashRowsContext = createContext<Row[]>([]);

// Field ids arrive as 'requests.status' etc. depending on resolution — match loosely.
const fieldId = (field: AgWidgetField) =>
  String((field as { fieldId?: string }).fieldId ?? field.key ?? "");

// The engine row may key values by bare field id or by qualified id.
const rowValue = (data: Record<string, unknown> | undefined, field: string) =>
  data?.[field] ?? data?.[`requests.${field}`];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 'Nov 5, 7:01 PM' — never raw timestamps in the grid.
function fmtCellDate(iso: unknown): string {
  const d = new Date(String(iso));
  if (isNaN(+d)) return String(iso ?? "");
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h}:${m} ${ap}`;
}

const isFooter = (
  data: CustomCellRendererProps["data"],
  node: CustomCellRendererProps["node"]
) => (node as { footer?: boolean } | undefined)?.footer || data == null;

function StatusCell({ value, data }: CustomCellRendererProps) {
  const rows = useContext(DashRowsContext);
  if (!value) return null;
  // OFFERED only exists on shelf cards — it isn't a request status, so it
  // takes the option badge rather than StatusBadge's FAILED fallback.
  // (Card REJECTED rows render "Skipped" through the normal path.)
  if (value === "OFFERED") {
    return (
      <span className="status-cell">
        <OptBadge state="offered" />
      </span>
    );
  }
  // The grid row only carries mapped columns — `decision`/`orderId` aren't
  // among them — so the row is matched back to the full dashboard rows by
  // title + amount.
  const title = rowValue(data as Record<string, unknown>, "title");
  const amount = Number(rowValue(data as Record<string, unknown>, "amount"));
  const row = rows.find(
    (r) =>
      r.kind === "request" &&
      r.title === title &&
      (isNaN(amount) || r.amount === amount)
  );
  return (
    <span className="status-cell">
      <StatusBadge
        status={String(value)}
        decision={row?.decision ?? null}
        hasOrder={row?.orderId != null}
      />
    </span>
  );
}

function FirstColCell({ value, data, node }: CustomCellRendererProps) {
  const rows = useContext(DashRowsContext);
  // Footer row: "Total bought" matches the Spent KPI tile (PURCHASED rows only).
  if (isFooter(data, node)) {
    const bought = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
    return (
      <span className="grand-total-label">
        Total bought <b>${bought.toFixed(2)}</b>
      </span>
    );
  }
  const blocked = rowValue(data as Record<string, unknown>, "status") === "BLOCKED";
  return (
    <span className={blocked ? "blocked-row-mark" : undefined}>
      {fmtCellDate(value)}
    </span>
  );
}

function ItemCell({ value, data, node }: CustomCellRendererProps) {
  const rows = useContext(DashRowsContext);
  // Footer row: the all-statuses counterpart next to "Total bought".
  if (isFooter(data, node)) {
    const listed = rows.reduce((s, r) => s + r.amount, 0);
    return (
      <span className="grand-total-label muted">
        Total listed (all rows) <b>${listed.toFixed(2)}</b>
      </span>
    );
  }
  const url = rowValue(data as Record<string, unknown>, "merchantUrl");
  return url ? (
    <a href={String(url)} target="_blank" rel="noreferrer">
      {String(value ?? "")}
    </a>
  ) : (
    <>{value == null ? "" : String(value)}</>
  );
}

function AmountCell({ value, data, node }: CustomCellRendererProps) {
  // The footer number would be the page's sum — misleading next to totals
  // computed over every request, so it stays empty.
  if (isFooter(data, node)) return null;
  const n = Number(value);
  return isNaN(n) ? null : <span className="grid-amount">${n.toFixed(2)}</span>;
}

export function createCellRenderer(
  field: AgWidgetField
): ComponentType<CustomCellRendererProps> | undefined {
  const id = fieldId(field);
  if (id === "requests.status" || id === "status") return StatusCell;
  if (id === "requests.createdAt" || id === "createdAt") return FirstColCell;
  if (id === "requests.title" || id === "title") return ItemCell;
  if (id === "requests.amount" || id === "amount") return AmountCell;
  return undefined;
}
