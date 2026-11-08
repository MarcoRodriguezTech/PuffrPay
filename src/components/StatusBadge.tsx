import type { PolicyDecision, PurchaseStatus } from "@/lib/types";
import { STATUS_BY_KEY, statusKey } from "@/lib/status";

export { statusKey };
export type { StatusKey } from "@/lib/status";

export function StatusBadge({
  status,
  decision,
}: {
  status: PurchaseStatus | string;
  decision?: PolicyDecision | string | null;
}) {
  const s = STATUS_BY_KEY[statusKey(status, decision)];
  return (
    <span className={`status-badge ${s.key}`} title={s.label}>
      {s.icon}
      {s.label}
    </span>
  );
}

export type OptionCardState = "offered" | "skipped" | "blocked";

// Option-card rows share the request-row badge anatomy but speak the shelf
// vocabulary: Offered (set still live), Skipped (unchosen once resolved —
// same word the human-declined REJECTED status shows), Blocked (the rules
// refused the card — same badge as a blocked request).
export function OptBadge({ state }: { state: OptionCardState }) {
  if (state === "blocked") return <StatusBadge status="BLOCKED" />;
  const offered = state === "offered";
  return (
    <span
      className={`status-badge ${offered ? "OFFERED" : "SKIPPED"}`}
      title={offered ? "Offered — still pickable on the carousel" : "Skipped"}
    >
      {offered ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="1.5" y="4" width="7" height="5.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4 4V2.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6h7" strokeWidth="2" strokeLinecap="round" fill="none" stroke="currentColor" />
        </svg>
      )}
      {offered ? "Offered" : "Skipped"}
    </span>
  );
}
