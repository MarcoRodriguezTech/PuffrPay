"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/** Single source for the mascot art — swap files in /public/mascot to restyle.
    Files carry a version suffix so a new render can never hit a cached
    /_next/image rendition of the previous fish — bump the suffix on the next
    art swap. */
export const MASCOT_SRC = "/mascot/puffr-v2.png";

export type PufferState = "calm" | "swelling" | "puffed" | "super" | "maxed";

// One render per gauge state; maxed reuses the super-puffed art plus the Max tag.
const MASCOT_ART: Record<PufferState, string> = {
  calm: "/mascot/puffr-calm-v2.png",
  swelling: "/mascot/puffr-swelling-v2.png",
  puffed: "/mascot/puffr-puffed-v2.png",
  super: "/mascot/puffr-super-puffed-v2.png",
  maxed: "/mascot/puffr-super-puffed-v2.png",
};

export function stateForRatio(ratio: number): PufferState {
  if (ratio >= 1) return "maxed";
  if (ratio >= 0.9) return "super";
  if (ratio >= 0.8) return "puffed";
  if (ratio >= 0.5) return "swelling";
  return "calm";
}

export const STATE_LABELS: Record<PufferState, string> = {
  calm: "Calm",
  swelling: "Swelling",
  puffed: "Puffed",
  super: "Super puffed",
  maxed: "Maxed out",
};

const BUBBLES = 5;

export function PufferGauge({
  ratio,
  size = 160,
  showLabel = false,
  label,
  blockedAt,
}: {
  /** spent / cap — can exceed 1 */
  ratio: number;
  /** nominal art size: 28, 96, 140, 160, or 220 px */
  size?: number;
  showLabel?: boolean;
  /** overrides the state name under the fish (classic log shows "???" at 90+) */
  label?: string;
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
        <Image
          src={MASCOT_ART[state]}
          width={size}
          height={size}
          quality={90}
          alt=""
          className="art"
          style={{ position: "absolute", left: off, top: off, objectFit: "contain" }}
        />
        {decorated && (
          <span
            className="fx"
            style={{ left: off, top: off, width: size, height: size }}
          >
            <svg className="drop d1" style={{ left: "70%", top: "18%" }} viewBox="0 0 7 10" aria-hidden="true">
              <path d="M3.5 0C3.5 0 7 5 7 7a3.5 3.5 0 0 1-7 0C0 5 3.5 0 3.5 0Z" />
            </svg>
            <svg className="drop d2" style={{ left: "77%", top: "30%" }} viewBox="0 0 7 10" aria-hidden="true">
              <path d="M3.5 0C3.5 0 7 5 7 7a3.5 3.5 0 0 1-7 0C0 5 3.5 0 3.5 0Z" />
            </svg>
            {Array.from({ length: BUBBLES }, (_, i) => (
              <i key={i} className={`bubble b${i + 1}`} />
            ))}
            <span className="max-tag">Max</span>
          </span>
        )}
      </span>
      {showLabel && (
        <span className="puffer-label">{label ?? STATE_LABELS[state]}</span>
      )}
    </span>
  );
}
