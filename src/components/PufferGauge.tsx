"use client";

import { useEffect, useRef, useState } from "react";

/** Single source for the mascot art — swap this file to restyle everywhere. */
export const MASCOT_SRC = "/mascot/puffr-placeholder.svg";

export type PufferState = "calm" | "swelling" | "puffed" | "maxed";

export function stateForRatio(ratio: number): PufferState {
  if (ratio >= 1) return "maxed";
  if (ratio >= 0.8) return "puffed";
  if (ratio >= 0.5) return "swelling";
  return "calm";
}

export const STATE_LABELS: Record<PufferState, string> = {
  calm: "Calm",
  swelling: "Swelling",
  puffed: "Puffed",
  maxed: "Maxed out",
};

const SPIKES = 8;
const BUBBLES = 5;

// Positions inside the .fx overlay box (percent of the overlay).
const spikeAt = (i: number) => {
  const a = (i / SPIKES) * Math.PI * 2 - Math.PI / 2;
  return {
    left: `${50 + 46 * Math.cos(a)}%`,
    top: `${50 + 46 * Math.sin(a)}%`,
    transform: `translate(-50%, -50%) rotate(${(a * 180) / Math.PI + 90}deg)`,
  };
};

export function PufferGauge({
  ratio,
  size = 160,
  showLabel = false,
  blockedAt,
}: {
  /** spent / cap — can exceed 1 */
  ratio: number;
  /** nominal art size: 28, 96, 140, 160, or 220 px */
  size?: number;
  showLabel?: boolean;
  /** when this timestamp changes the fish plays the 600ms puff animation */
  blockedAt?: number | null;
}) {
  const state = stateForRatio(ratio);
  const [puffing, setPuffing] = useState(false);
  const prev = useRef(blockedAt);

  useEffect(() => {
    if (blockedAt && blockedAt !== prev.current) {
      setPuffing(true);
      const t = setTimeout(() => setPuffing(false), 650);
      return () => clearTimeout(t);
    }
    prev.current = blockedAt;
  }, [blockedAt]);

  // The layout box reserves room for the largest scale + spikes, so the fish
  // can never overlap the heading above it. Small gauges skip the overlays.
  const decorated = size >= 96;
  const box = Math.ceil(size * (decorated ? 1.5 : 1.2));
  const off = (box - size) / 2;

  return (
    <span
      className={`puffer ${state}${puffing ? " puffing" : ""}`}
      role="img"
      aria-label={`Allowance gauge: ${STATE_LABELS[state]}`}
    >
      <span className="art-wrap" style={{ width: box, height: box }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={MASCOT_SRC}
          width={size}
          height={size}
          alt=""
          className="art"
          style={{ position: "absolute", left: off, top: off }}
        />
        <span className="tint" style={{ left: off, top: off, width: size, height: size }} />
        {decorated && (
          <span
            className="fx"
            style={{ left: off, top: off, width: size, height: size }}
          >
            {Array.from({ length: SPIKES }, (_, i) => (
              <i key={i} className="spike" style={spikeAt(i)} />
            ))}
            <svg className="drop d1" style={{ left: "70%", top: "18%" }} viewBox="0 0 7 10" aria-hidden="true">
              <path d="M3.5 0C3.5 0 7 5 7 7a3.5 3.5 0 0 1-7 0C0 5 3.5 0 3.5 0Z" />
            </svg>
            <svg className="drop d2" style={{ left: "77%", top: "30%" }} viewBox="0 0 7 10" aria-hidden="true">
              <path d="M3.5 0C3.5 0 7 5 7 7a3.5 3.5 0 0 1-7 0C0 5 3.5 0 3.5 0Z" />
            </svg>
            <svg className="eyes" viewBox="0 0 100 100" aria-hidden="true">
              <circle cx="36" cy="40" r="7" />
              <circle cx="62" cy="40" r="7" />
              <circle cx="37" cy="41" r="2.6" fill="var(--ink)" stroke="none" />
              <circle cx="63" cy="41" r="2.6" fill="var(--ink)" stroke="none" />
            </svg>
            {Array.from({ length: BUBBLES }, (_, i) => (
              <i key={i} className={`bubble b${i + 1}`} />
            ))}
            <span className="max-tag">Max</span>
          </span>
        )}
      </span>
      {showLabel && <span className="puffer-label">{STATE_LABELS[state]}</span>}
    </span>
  );
}
