import type { PolicyDecision, PurchaseStatus } from "@/lib/types";

const S = 12;
const stroke = { strokeWidth: 2, strokeLinecap: "round" as const, fill: "none", stroke: "currentColor" };

// Display key: WAITING splits into Awaiting PayPal (ALLOW, mid-checkout) and
// Waiting for you (ASK, needs owner approval) — same labels everywhere the
// status shows.
export type StatusKey = "PURCHASED" | "PAYPAL" | "WAITING" | "BLOCKED" | "REJECTED" | "FAILED";

export function statusKey(status: string, decision?: string | null): StatusKey {
  if (status === "WAITING") {
    return decision === "ALLOW" ? "PAYPAL" : "WAITING";
  }
  return (status in LABELS ? status : "FAILED") as StatusKey;
}

export const STATUS_COLORS: Record<StatusKey, string> = {
  PURCHASED: "var(--st-bought)",
  PAYPAL: "var(--st-paypal)",
  WAITING: "var(--st-waiting)",
  BLOCKED: "var(--st-blocked)",
  REJECTED: "var(--st-rejected)",
  FAILED: "var(--st-rejected)",
};

const ICONS: Record<StatusKey, React.ReactNode> = {
  PURCHASED: (
    <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.5 5 9.5 10 3" {...stroke} />
    </svg>
  ),
  // Hourglass — the PayPal sandbox checkout is still open.
  PAYPAL: (
    <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 2h6M3 10h6M4 2v1.4L6 5.8 8 3.4V2M4 10V8.6L6 6.2 8 8.6V10" {...stroke} />
    </svg>
  ),
  WAITING: (
    <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 4.2C4 3 5 2.2 6.1 2.2c1.3 0 2.2.9 2.2 2 0 1.6-2 1.8-2 3.2" {...stroke} />
      <circle cx="6.2" cy="9.8" r="0.9" fill="currentColor" />
    </svg>
  ),
  BLOCKED: (
    <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" {...stroke} />
    </svg>
  ),
  REJECTED: (
    <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6h7" {...stroke} />
    </svg>
  ),
  FAILED: (
    <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 2v5" {...stroke} />
      <circle cx="6" cy="9.6" r="0.9" fill="currentColor" />
    </svg>
  ),
};

const LABELS: Record<StatusKey, string> = {
  PURCHASED: "Bought",
  PAYPAL: "Awaiting PayPal",
  WAITING: "Waiting for you",
  BLOCKED: "Blocked",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

export function StatusBadge({
  status,
  decision,
}: {
  status: string;
  decision?: PolicyDecision | string | null;
}) {
  const s = statusKey(status, decision);
  return (
    <span className={`status-badge ${s}`}>
      {ICONS[s]}
      {LABELS[s]}
    </span>
  );
}
