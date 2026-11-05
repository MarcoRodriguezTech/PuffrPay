"use client";

// Custom cell renderers for the Studio grid widget, wired through the 'grid'
// widget definition's `options.createCellRenderer` (see activity.tsx). They
// only claim the columns they recognise; every other field keeps Studio's
// default rendering.

import type { AgWidgetField } from "ag-studio";
import type { ComponentType } from "react";
import type { CustomCellRendererProps } from "ag-grid-react";
import { StatusBadge } from "@/components/StatusBadge";

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

function StatusCell({ value }: CustomCellRendererProps) {
  return value ? (
    <span className="status-cell">
      <StatusBadge status={String(value)} />
    </span>
  ) : null;
}

function FirstColCell({ value, data, node }: CustomCellRendererProps) {
  // The grand total footer sums every status, so its label must not read as
  // spend-against-cap ($172) — spell out what it actually totals. Footer rows
  // carry no row data, which is the reliable tell here.
  if ((node as { footer?: boolean } | undefined)?.footer || data == null) {
    return <span className="grand-total-label">Total requested (all statuses)</span>;
  }
  const blocked = rowValue(data as Record<string, unknown>, "status") === "BLOCKED";
  return (
    <span className={blocked ? "blocked-row-mark" : undefined}>
      {fmtCellDate(value)}
    </span>
  );
}

function AmountCell({ value }: CustomCellRendererProps) {
  const n = Number(value);
  return isNaN(n) ? null : <span className="grid-amount">${n.toFixed(2)}</span>;
}

function ItemCell({ value, data }: CustomCellRendererProps) {
  const url = rowValue(data as Record<string, unknown>, "merchantUrl");
  return url ? (
    <a href={String(url)} target="_blank" rel="noreferrer">
      {String(value ?? "")}
    </a>
  ) : (
    <>{value == null ? "" : String(value)}</>
  );
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
