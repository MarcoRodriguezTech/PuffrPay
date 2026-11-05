"use client";

import { useEffect, useRef, useState } from "react";

/** Tiny client-side event helpers shared by the screens. */

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent("puffr:toast", { detail: message }));
}

/** Ask the header BudgetPill (and any listener) to refetch /api/budget. */
export function refreshBudget() {
  window.dispatchEvent(new Event("puffr:budget"));
}

export const BUDGET_EVENT = "puffr:budget";
export const TOAST_EVENT = "puffr:toast";

const PUFF_KEY = "puffr:puff-at";

/** Ask the next screen showing a PufferGauge to play the puff animation. */
export function flagPuffNextLoad() {
  try {
    sessionStorage.setItem(PUFF_KEY, String(Date.now()));
  } catch {
    /* private mode — non-fatal */
  }
}

/** Returns the stored timestamp once, or null. */
export function consumePuffFlag(): number | null {
  try {
    const v = sessionStorage.getItem(PUFF_KEY);
    if (!v) return null;
    sessionStorage.removeItem(PUFF_KEY);
    return Number(v) || null;
  } catch {
    return null;
  }
}

export const fmtDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** '$172' style — drops the cents when the amount is whole dollars. */
export const fmtWhole = (cents: number) =>
  cents % 100 === 0
    ? `$${Math.round(cents / 100)}`
    : `$${(cents / 100).toFixed(2)}`;

export const isRateLimitMsg = (msg: string) =>
  /429|rate|quota|resource_exhausted|too many|busy/i.test(msg);

export function storeOf(merchantUrl: string | null): string {
  if (!merchantUrl) return "store";
  try {
    return new URL(merchantUrl).hostname.replace(/^www\./, "");
  } catch {
    return merchantUrl;
  }
}

/** The generic message shown when an API call fails — never raw server text. */
export const GENERIC_ERROR = "Something went wrong on our side. Try again.";

/** Map a failed fetch/response to a friendly message; details go to console. */
export function friendlyClientError(err: unknown): string {
  console.error("[api]", err);
  const msg = err instanceof Error ? err.message : String(err);
  return isRateLimitMsg(msg)
    ? "Puffr is catching its breath. Try again in a minute."
    : GENERIC_ERROR;
}

/** Count up/down to `value` over 500ms when it changes (skips first paint). */
export function useCountUp(value: number, duration = 500): number {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      prev.current = value;
      setDisplay(value);
      return;
    }
    if (prev.current === value) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      prev.current = value;
      setDisplay(value);
      return;
    }
    const from = prev.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}
