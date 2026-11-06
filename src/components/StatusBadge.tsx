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
