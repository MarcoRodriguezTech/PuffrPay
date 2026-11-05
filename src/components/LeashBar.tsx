// The ASCII "leash" progress bar: a real progressbar for screen readers with
// the text-art version drawn on top — e.g. [##########>----------].

export function LeashBar({
  ratio,
  width = 22,
  label = "Fun money used this month",
}: {
  /** spent / cap, can exceed 1 */
  ratio: number;
  /** number of cells between the brackets */
  width?: number;
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  const filled = Math.min(width, Math.round((pct / 100) * width));
  const empty = width - filled;
  return (
    <span
      className="leash-bar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">
        {"["}
        <span className="leash-fill">{"#".repeat(filled)}</span>
        <span className="leash-fish">{filled >= width ? "#" : ">"}</span>
        {"-".repeat(Math.max(0, empty - 1))}
        {"]"}
      </span>
    </span>
  );
}
