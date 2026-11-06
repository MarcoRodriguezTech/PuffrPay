"use client";

import { useEffect, type RefObject } from "react";

// The mascot drifts around its container like a fish in a tank, bouncing off
// the tank's side walls, the bottom of `ceilingSel` (or the tank's padding-top
// when omitted), and the top of `floorSel`. Layout position stays put — only
// transform animates — so nothing reflows. Honors prefers-reduced-motion.
export function usePufferDrift(
  mascotRef: RefObject<HTMLElement | null>,
  tankSel: string,
  ceilingSel: string | null,
  floorSel: string,
  // re-check when the mascot mounts later than its parent (e.g. after a fetch)
  ready = true,
) {
  useEffect(() => {
    const mascot = mascotRef.current;
    const tank = mascot?.closest<HTMLElement>(tankSel);
    const ceiling = ceilingSel
      ? tank?.querySelector<HTMLElement>(ceilingSel)
      : null;
    const floor = tank?.querySelector<HTMLElement>(floorSel);
    const img = mascot?.querySelector<HTMLElement>("img.art");
    if (!mascot || !tank || !floor) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Home position measured tank-relative before any transform lands —
    // offsetLeft/offsetTop would be relative to whatever ancestor happens to
    // be positioned, not necessarily the tank.
    const tankR0 = tank.getBoundingClientRect();
    const mR0 = mascot.getBoundingClientRect();
    const homeL = mR0.left - tankR0.left;
    const homeT = mR0.top - tankR0.top;

    let pos = { x: 0, y: 0 };
    let vel = { x: 60, y: 45 };
    let flipped = false;
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Displacement bounds derived from the transform-free home position.
      // The gauge box pads the art ~1.5x for fx, so the bounds use the art's
      // edge — the fish visibly touches the walls and the floor.
      const tankR = tank.getBoundingClientRect();
      const cs = getComputedStyle(tank);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const headB = ceiling
        ? ceiling.getBoundingClientRect().bottom - tankR.top + 4
        : parseFloat(cs.paddingTop) || 0;
      const floorT = floor.getBoundingClientRect().top - tankR.top - 4;
      const w = mascot.offsetWidth;
      const h = mascot.offsetHeight;
      const inset = img ? (h - img.offsetHeight) / 2 : 0;
      const minX = padL - homeL - inset;
      const maxX = tankR.width - padR - w - homeL + inset;
      const minY = headB - homeT - inset;
      const maxY = floorT - h - homeT + inset;

      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      if (pos.x <= minX) { pos.x = minX; vel.x = Math.abs(vel.x); }
      else if (pos.x >= maxX) { pos.x = maxX; vel.x = -Math.abs(vel.x); }
      if (minY <= maxY) {
        if (pos.y <= minY) { pos.y = minY; vel.y = Math.abs(vel.y); }
        else if (pos.y >= maxY) { pos.y = maxY; vel.y = -Math.abs(vel.y); }
      } else {
        pos.y = 0;
      }

      const wantFlip = vel.x < 0;
      if (wantFlip !== flipped && img) {
        flipped = wantFlip;
        img.classList.toggle("flip", flipped);
      }
      mascot.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mascotRef, tankSel, ceilingSel, floorSel, ready]);
}
