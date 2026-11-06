"use client";

/**
 * Stacked coverflow carousel for the agent's option picks — a port of the
 * 21st.dev stacked-card pattern to this project's token system (no Tailwind /
 * shadcn in this repo). Drag/swipe to browse; the center card is the current
 * pick, chosen via the detached Pick button below (cards sit under the drag
 * surface, so per-card buttons can't receive clicks).
 * Reduced-motion users get a plain scrollable row instead of physics.
 */

import * as React from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  useMotionValueEvent,
  useReducedMotion,
  LazyMotion,
  domAnimation,
  type PanInfo,
  type MotionValue,
} from "motion/react";
import type { AgentOptionsPayload, OptionsItem } from "@/lib/agent";
import { fmtDollars, storeOf } from "@/lib/ui";

interface StackConfig {
  distanceDivisor: number;
  velocityDivisor: number;
  sensitivity: number;
  xMultiplier: number;
  yMultiplier: number;
  rotationMultiplier: number;
  scaleReduction: number;
}

const getConfig = (width: number): StackConfig => {
  if (width < 640) {
    return {
      distanceDivisor: 120,
      velocityDivisor: 500,
      sensitivity: 180,
      xMultiplier: 184,
      yMultiplier: 34,
      rotationMultiplier: 8,
      scaleReduction: 0.06,
    };
  }
  return {
    distanceDivisor: 200,
    velocityDivisor: 800,
    sensitivity: 250,
    xMultiplier: 300,
    yMultiplier: 56,
    rotationMultiplier: 10,
    scaleReduction: 0.1,
  };
};

const wrapIndex = (i: number, total: number) =>
  ((i % total) + total) % total;

export function OptionStack({
  msgId,
  payload,
  busy,
  onPick,
  onDismiss,
  onRemove,
}: {
  msgId: number;
  payload: AgentOptionsPayload;
  busy: boolean;
  onPick: (messageId: number, productId: string) => void;
  onDismiss: (messageId: number) => void;
  onRemove: (messageId: number, productId: string) => void;
}) {
  const items = payload.items;
  const total = items.length;
  const reduced = useReducedMotion();

  const scrollProgress = useMotionValue(0);
  const startProgress = React.useRef(0);
  const zoneRef = React.useRef<HTMLDivElement>(null);
  const [zoneW, setZoneW] = React.useState(0);
  const [activeIdx, setActiveIdx] = React.useState(0);

  React.useEffect(() => {
    const el = zoneRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setZoneW(e.contentRect.width);
    });
    ro.observe(el);
    setZoneW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const config = React.useMemo(() => getConfig(zoneW), [zoneW]);

  useMotionValueEvent(scrollProgress, "change", (v) => {
    setActiveIdx(wrapIndex(Math.round(v), total));
  });

  const handleDragStart = () => {
    startProgress.current = scrollProgress.get();
  };

  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    const distanceShift = -info.offset.x / config.distanceDivisor;
    const velocityShift = -info.velocity.x / config.velocityDivisor;
    let totalShift = Math.round(distanceShift + velocityShift);
    totalShift = Math.max(-3, Math.min(3, totalShift));
    const target = Math.round(startProgress.current) + totalShift;
    animate(scrollProgress, target, {
      type: "spring",
      stiffness: 200,
      damping: 30,
      mass: 1,
    });
  };

  const active = total > 0 ? items[wrapIndex(activeIdx, total)] : undefined;
  const activeBlocked = active?.decision === "BLOCK";

  if (reduced) {
    // No physics under prefers-reduced-motion: a plain scrollable row.
    return (
      <div className="stack-wrap">
        <div className="stack-fallback" role="list">
          {items.map((it) => (
            <div key={it.id} role="listitem" className="opt-card">
              <button
                type="button"
                className="stack-remove"
                aria-label={`Remove ${it.title}`}
                onClick={() => onRemove(msgId, it.id)}
                disabled={busy}
              >
                ×
              </button>
              {it.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="product-thumb opt-thumb"
                  src={it.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="product-thumb opt-thumb" aria-hidden="true">
                  {it.title?.[0]?.toUpperCase() ?? "?"}
                </span>
              )}
              <span className="opt-tag">{it.tag}</span>
              <span className="opt-title">{it.title}</span>
              <span className="opt-price">
                {fmtDollars(it.priceCents)}
                <span className="s">{storeOf(it.merchantUrl)}</span>
              </span>
              {it.decision === "BLOCK" ? (
                <span className="opt-blocked">{it.decisionReason}</span>
              ) : (
                <button
                  type="button"
                  className="opt-pick"
                  onClick={() => onPick(msgId, it.id)}
                  disabled={busy}
                >
                  Pick this
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="stack-pickrow">
          <button
            type="button"
            className="stack-close"
            aria-label="Skip these picks"
            onClick={() => onDismiss(msgId)}
            disabled={busy}
          >
            ×
          </button>
          <span className="stack-hint">not into any of these?</span>
        </div>
      </div>
    );
  }

  return (
    // LazyMotion ships the small feature bundle — drag/transform/animate are
    // all covered by domAnimation. Same physics, less JS.
    <LazyMotion features={domAnimation}>
      <div className="stack-wrap">
      <div className="stack-zone" ref={zoneRef}>
        {/* transparent drag surface above the cards */}
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          onDragStart={handleDragStart}
          onDrag={(_, info) => {
            const delta = -info.delta.x / config.sensitivity;
            scrollProgress.set(scrollProgress.get() + delta);
          }}
          onDragEnd={handleDragEnd}
          className="stack-surface"
        />
        {items.map((it, i) => (
          <StackCard
            key={it.id}
            item={it}
            index={i}
            total={total}
            progress={scrollProgress}
            config={config}
            busy={busy}
            onRemove={() => onRemove(msgId, it.id)}
          />
        ))}
      </div>
      {active && (
        <div className="stack-pickrow">
          <span className="stack-active">
            <span className={`opt-chip ${active.decision.toLowerCase()}`}>
              {active.decision === "ALLOW"
                ? "Auto-buys"
                : active.decision === "ASK"
                  ? "Needs your OK"
                  : "Blocked"}
            </span>
            <strong>{active.title}</strong> — {fmtDollars(active.priceCents)}
          </span>
          {activeBlocked ? (
            <span className="opt-blocked">{active.decisionReason}</span>
          ) : (
            <span className="stack-btnrow">
              <button
                type="button"
                className="opt-pick stack-pick-btn"
                onClick={() => onPick(msgId, active.id)}
                disabled={busy}
              >
                {busy && <span className="spinner" aria-hidden="true" />}
                Pick this
              </button>
              <button
                type="button"
                className="stack-close"
                aria-label="Skip these picks"
                onClick={() => onDismiss(msgId)}
                disabled={busy}
              >
                ×
              </button>
            </span>
          )}
          <span className="stack-hint">
            {activeBlocked ? "drag to browse — × removes it" : "drag to browse · × to bail"}
          </span>
        </div>
      )}
      </div>
    </LazyMotion>
  );
}

function StackCard({
  item,
  index,
  total,
  progress,
  config,
  busy,
  onRemove,
}: {
  item: OptionsItem;
  index: number;
  total: number;
  progress: MotionValue<number>;
  config: StackConfig;
  busy: boolean;
  onRemove: () => void;
}) {
  const offset = useTransform(progress, (p) => {
    let diff = (index - p) % total;
    if (diff > total / 2) diff -= total;
    if (diff < -total / 2) diff += total;
    return diff;
  });

  const x = useTransform(offset, (o) => o * config.xMultiplier);
  const rotate = useTransform(offset, (o) =>
    Math.abs(o) < 0.05 ? 0 : o * config.rotationMultiplier
  );
  const y = useTransform(offset, (o) =>
    Math.abs(o) < 0.05 ? 0 : Math.abs(o) * config.yMultiplier
  );
  const scale = useTransform(
    offset,
    (o) => 1 - Math.abs(o) * config.scaleReduction
  );
  const opacity = useTransform(
    offset,
    [-total / 2, -total / 2 + 0.5, 0, total / 2 - 0.5, total / 2],
    [0, 1, 1, 1, 0]
  );
  const zIndex = useTransform(offset, (o) =>
    Math.round(100 - Math.abs(o) * 10)
  );
  const shadeOpacity = useTransform(
    offset,
    [-2, -0.5, 0, 0.5, 2],
    [0.5, 0.2, 0, 0.2, 0.5]
  );
  const metaOpacity = useTransform(offset, [-0.5, 0, 0.5], [0, 1, 0]);

  return (
    <motion.div
      style={{ x, rotate, y, scale, opacity, zIndex }}
      className="stack-card"
    >
      <div className="stack-imgwrap">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="stack-img"
            src={item.imageUrl}
            alt={item.title}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="stack-img stack-noimg" aria-hidden="true">
            {item.title?.[0]?.toUpperCase() ?? "?"}
          </span>
        )}
      </div>
      <motion.div style={{ opacity: shadeOpacity }} className="stack-shade" />
      {/* pointer-events:auto lets the × receive clicks despite the card's
          pointer-events:none — it sits beside (not under) the drag surface */}
      <button
        type="button"
        className="stack-remove"
        aria-label={`Remove ${item.title}`}
        onClick={onRemove}
        disabled={busy}
      >
        ×
      </button>
      <span className="stack-badge">{item.tag}</span>
      <motion.div style={{ opacity: metaOpacity }} className="stack-meta">
        <span className="stack-title">{item.title}</span>
        <span className="stack-price">
          {fmtDollars(item.priceCents)}
          <span className="s">{storeOf(item.merchantUrl)}</span>
        </span>
      </motion.div>
    </motion.div>
  );
}
