// Compact pill progress bar for the fun-money gauge — renders a real
// progressbar for screen readers.

export function LeashBar({
  ratio,
  width = 64,
  label = "Fun money used this month",
}: {
  /** spent / cap, can exceed 1 */
  ratio: number;
  /** bar width — px number or any CSS length */
  width?: number | string;
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  return (
    <span
      className="leash-bar"
      style={{ width }}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      title={label}
    >
      <span className="leash-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}
