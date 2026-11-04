"use client";

import { useEffect, useRef, useState } from "react";

/** Single source for the mascot art — swap the file or path to restyle. */
export const MASCOT_SRC = "/mascot/puffr-placeholder.svg";

export type PufferState = "calm" | "swelling" | "puffed" | "maxed";

export function stateForRatio(ratio: number): PufferState {
  if (ratio >= 1) return "maxed";
  if (ratio >= 0.8) return "puffed";
  if (ratio >= 0.5) return "swelling";
  return "calm";
}

const STATE_LABEL: Record<PufferState, string> = {
  calm: "calm",
  swelling: "swelling",
  puffed: "puffed, red",
  maxed: "fully puffed — agent blocked",
};

export function PufferGauge({
  ratio,
  spentCents,
  capCents,
  size = 140,
  flash = false,
}: {
  ratio: number;
  spentCents: number;
  capCents: number;
  size?: number;
  /** brief puff animation when a purchase was just blocked */
  flash?: boolean;
}) {
  const state = stateForRatio(ratio);
  const [flashing, setFlashing] = useState(false);
  const prevFlash = useRef(flash);

  useEffect(() => {
    if (flash && !prevFlash.current) {
      setFlashing(true);
      const t = setTimeout(() => setFlashing(false), 700);
      return () => clearTimeout(t);
    }
    prevFlash.current = flash;
  }, [flash]);

  const pct = Math.round(ratio * 100);
  const dollars = (c: number) => `$${(c / 100).toFixed(0)}`;

  return (
    <div
      className={`puffer ${state} ${flashing ? "puff-flash" : ""}`}
      aria-label={`Budget ${pct}% used — ${STATE_LABEL[state]}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={MASCOT_SRC} alt="Puffr the pufferfish" width={size} height={size} className="art" />
      <div className="mono">
        {dollars(spentCents)} of {dollars(capCents)}
      </div>
      <div className="state-label">
        [{"".padEnd(Math.min(10, Math.round(ratio * 10)), "#").padEnd(10, "-")}]{" "}
        {pct}% — {STATE_LABEL[state]}
      </div>
      {state === "maxed" && (
        <div className="blocked-note">
          Monthly cap reached — the agent is blocked from buying.
        </div>
      )}
    </div>
  );
}
