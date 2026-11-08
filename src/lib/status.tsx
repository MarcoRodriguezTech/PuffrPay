// The ONE status vocabulary for the whole app — order, labels, icons, theme
// color tokens, the display-key mapping, and Studio filter helpers. Badges,
// the Leash report bar + legend, grids, charts and audit answers all read
// from this table so a status can never drift between components.

import type { ReactNode } from "react";
import type { AgFilterState } from "ag-studio";

// Display key: WAITING splits into Awaiting PayPal (ALLOW, mid-checkout) and
// Waiting for you (ASK, needs owner approval) — the six keys below are the
// only words the UI ever uses for status.
export type StatusKey =
  | "PURCHASED"
  | "PAYPAL"
  | "WAITING"
  | "BLOCKED"
  | "REJECTED"
  | "FAILED";

const S = 12;
const stroke = {
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  fill: "none",
  stroke: "currentColor",
};

export interface StatusInfo {
  key: StatusKey;
  label: string;
  icon: ReactNode;
  // --st-* token; concrete colors are themed dark/light in globals.css.
  colorVar: string;
}

export const STATUSES: readonly StatusInfo[] = [
  {
    key: "PURCHASED",
    label: "Bought",
    colorVar: "var(--st-bought)",
    icon: (
      <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 6.5 5 9.5 10 3" {...stroke} />
      </svg>
    ),
  },
  {
    // Hourglass — the PayPal sandbox checkout is still open.
    key: "PAYPAL",
    label: "Awaiting PayPal",
    colorVar: "var(--st-paypal)",
    icon: (
      <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M3 2h6M3 10h6M4 2v1.4L6 5.8 8 3.4V2M4 10V8.6L6 6.2 8 8.6V10"
          {...stroke}
        />
      </svg>
    ),
  },
  {
    key: "WAITING",
    label: "Waiting for you",
    colorVar: "var(--st-waiting)",
    icon: (
      <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M4 4.2C4 3 5 2.2 6.1 2.2c1.3 0 2.2.9 2.2 2 0 1.6-2 1.8-2 3.2"
          {...stroke}
        />
        <circle cx="6.2" cy="9.8" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: "BLOCKED",
    label: "Blocked",
    colorVar: "var(--st-blocked)",
    icon: (
      <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 3l6 6M9 3l-6 6" {...stroke} />
      </svg>
    ),
  },
  {
    // Owner-declined — its own word. "Skipped" stays option-card
    // vocabulary: unchosen shelf cards, not a decision the owner made.
    key: "REJECTED",
    label: "Rejected",
    colorVar: "var(--st-rejected)",
    icon: (
      <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 6h7" {...stroke} />
      </svg>
    ),
  },
  {
    key: "FAILED",
    label: "Failed",
    colorVar: "var(--st-failed)",
    icon: (
      <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 2v5" {...stroke} />
        <circle cx="6" cy="9.6" r="0.9" fill="currentColor" />
      </svg>
    ),
  },
];

export const STATUS_ORDER = STATUSES.map((s) => s.key);
export const STATUS_BY_KEY = Object.fromEntries(
  STATUSES.map((s) => [s.key, s])
) as Record<StatusKey, StatusInfo>;
export const STATUS_LABELS = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.label])
) as Record<StatusKey, string>;
export const STATUS_COLORS = Object.fromEntries(
  STATUSES.map((s) => [s.key, s.colorVar])
) as Record<StatusKey, string>;

export function statusKey(
  status: string,
  decision?: string | null,
  hasOrder?: boolean
): StatusKey {
  if (status === "WAITING") {
    // An open checkout is "Awaiting PayPal" no matter how the request got
    // there — an approved ASK keeps decision=ASK but now carries an order
    // id. `hasOrder` is the ground truth; the decision is only a fallback
    // for callers that can't see the order field (ALLOW went straight to
    // checkout).
    if (hasOrder != null) return hasOrder ? "PAYPAL" : "WAITING";
    return decision === "ALLOW" ? "PAYPAL" : "WAITING";
  }
  return (status in STATUS_LABELS ? status : "FAILED") as StatusKey;
}

// Display label for a raw status value (audit chips/answers); null if unknown.
export function statusLabel(raw: string): string | null {
  const key = raw.toUpperCase() as StatusKey;
  return key in STATUS_LABELS ? STATUS_LABELS[key] : null;
}

/* ---------- Studio page-filter helpers ---------- */

// Field ids on the requests table (studio/data.ts).
export const STATUS_FIELD = "requests.status";
export const DECISION_FIELD = "requests.decision";
// 1/0 flag on every row — text fields don't support null-test operators, so
// "has a PayPal order" filters on this integer equals instead of orderId.
export const ORDER_FIELD = "requests.hasOrder";

const eq = (id: string, value: string | number): AgFilterState =>
  ({ field: { id }, model: { operator: "equals", value } }) as AgFilterState;

// Filter entries selecting exactly this status — WAITING splits on whether a
// PayPal order exists (mirroring Policy's Awaiting PayPal queue), not the
// policy decision: an approved ASK keeps decision=ASK while carrying an
// order id, so decision-based filtering would mis-bucket it.
export function statusFilterEntries(key: StatusKey): AgFilterState[] {
  if (key === "PAYPAL")
    return [eq(STATUS_FIELD, "WAITING"), eq(ORDER_FIELD, 1)];
  if (key === "WAITING")
    return [eq(STATUS_FIELD, "WAITING"), eq(ORDER_FIELD, 0)];
  return [eq(STATUS_FIELD, key)];
}

// Any page-filter entry aimed at the status/decision/order fields — the
// leash owns status filtering, so a click replaces whatever status filter
// is live.
export function isStatusFilterEntry(f: AgFilterState): boolean {
  const id = f?.field?.id;
  return id === STATUS_FIELD || id === DECISION_FIELD || id === ORDER_FIELD;
}

// The status a page-filter set currently selects, or null. Reads equals- and
// null-test entries only, so ask-set status filters light up the bar too.
export function activeStatusKey(
  filters: AgFilterState[] | undefined | null
): StatusKey | null {
  if (!filters) return null;
  let status: string | null = null;
  let decision: string | null = null;
  let hasOrder: boolean | undefined;
  for (const f of filters) {
    if (f?.field?.id === STATUS_FIELD && f?.model?.operator === "equals") {
      status = String(f.model.value ?? "");
    }
    if (f?.field?.id === DECISION_FIELD && f?.model?.operator === "equals") {
      decision = String(f.model.value ?? "");
    }
    if (f?.field?.id === ORDER_FIELD && f?.model?.operator === "equals") {
      hasOrder = Number(f.model.value) === 1;
    }
  }
  if (!status) return null;
  return statusKey(status.toUpperCase(), decision?.toUpperCase() ?? null, hasOrder);
}
