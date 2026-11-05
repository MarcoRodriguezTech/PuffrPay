import type { PurchaseStatus } from "@/lib/types";

const S = 12;
const stroke = { strokeWidth: 2, strokeLinecap: "round" as const, fill: "none", stroke: "currentColor" };

const ICONS: Record<PurchaseStatus, React.ReactNode> = {
  PURCHASED: (
    <svg width={S} height={S} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.5 5 9.5 10 3" {...stroke} />
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

const LABELS: Record<PurchaseStatus, string> = {
  PURCHASED: "Bought",
  WAITING: "Waiting for you",
  BLOCKED: "Blocked",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

export function StatusBadge({ status }: { status: string }) {
  const s = (status in LABELS ? status : "FAILED") as PurchaseStatus;
  return (
    <span className={`status-badge ${s}`}>
      {ICONS[s]}
      {LABELS[s]}
    </span>
  );
}
