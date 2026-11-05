"use client";

// Custom Studio widgets that make up the Activity bento layout — the hero
// pieces of the reference dashboard that Studio's built-in charts can't draw:
// the "Spending this month" area chart with range pills, the Fun money card,
// the Recent activity list, the KPI tile row, rounded "Spend by day" bars,
// and the status pill bars. All read rows from Studio's `context` (the
// DashboardData), so they filter along with everything else only where noted.

import Link from "next/link";
import { useMemo, useRef, useState, useLayoutEffect } from "react";
import type { AgWidgetDefinition } from "ag-studio-react";
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import type { DashboardData } from "@/lib/dashboard-data";
import { PufferGauge, STATE_LABELS, stateForRatio } from "@/components/PufferGauge";
import { LeashBar } from "@/components/LeashBar";
import { fmtDollars, useCountUp } from "@/lib/ui";

type Row = DashboardData["requests"][number];
type Ctx = AgWidgetParams<AgWidgetData<Record<string, never>, AgWidgetDataFormat<unknown>>>;

const useRows = (params: Ctx): Row[] =>
  (params.context as { data?: DashboardData })?.data?.requests ?? [];

const noMap = ({ createDefaults }: { createDefaults: (o: object) => unknown }) =>
  createDefaults({ dataMappingItems: [] });

/* ---------- formatting ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const timeOf = (iso: string) => {
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h}:${m} ${ap}`;
};
const dayKey = (iso: string) => iso.slice(0, 10);
const money = (v: number) => `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
// Axis ticks always round to whole dollars: '$200', never '$200.00'.
const axisMoney = (v: number) => `$${Math.round(v)}`;

const STATUS_COLORS: Record<string, string> = {
  PURCHASED: "var(--ok)",
  WAITING: "var(--warn)",
  BLOCKED: "var(--danger)",
  REJECTED: "var(--reject)",
  FAILED: "var(--danger)",
};
const STATUS_LABEL: Record<string, string> = {
  PURCHASED: "Bought",
  WAITING: "Waiting",
  BLOCKED: "Blocked",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

/* ---------- svg helpers ---------- */

/** Catmull-Rom -> cubic bezier smooth path through points. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/* ---------- Spending this month: area chart + range pills ---------- */

type RangeKey = "week" | "month" | "all";
const RANGE_DAYS: Record<RangeKey, number | null> = { week: 7, month: 30, all: null };

function SpendTrend(params: Ctx) {
  const rows = useRows(params);
  const [range, setRange] = useState<RangeKey>("month");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, { w, h }] = useSize<HTMLDivElement>();

  const cap = rows[0]?.monthlyCap ?? 0;
  const spentTotal = useMemo(() => rows.reduce((s, r) => s + (r.spent ?? 0), 0), [rows]);
  const shownTotal = useCountUp(Math.round(spentTotal * 100)) / 100;

  const { days, delta } = useMemo(() => {
    const limit = RANGE_DAYS[range];
    const cutoff = limit == null ? "" : new Date(Date.now() - limit * 864e5).toISOString().slice(0, 10);
    const priorCut = limit == null ? "" : new Date(Date.now() - 2 * limit * 864e5).toISOString().slice(0, 10);

    // spend per day inside the range, and the range's total vs the previous
    // equal-length window for the change chip.
    const perDay = new Map<string, number>();
    let inSum = 0;
    let prevSum = 0;
    for (const r of rows) {
      const k = dayKey(r.createdAt);
      const v = r.spent ?? 0;
      if (k >= cutoff) {
        perDay.set(k, (perDay.get(k) ?? 0) + v);
        inSum += v;
      } else if (limit != null && k >= priorCut) {
        prevSum += v;
      }
    }
    const keys = [...perDay.keys()].sort();
    // walk every day from the first spend (or the cutoff) to today so the
    // cumulative line keeps its slope across quiet days.
    const first = limit == null ? keys[0] ?? "" : cutoff;
    const out: { key: string; cum: number }[] = [];
    let cum = limit == null ? 0 : rows.reduce((s, r) => (dayKey(r.createdAt) < cutoff ? s + (r.spent ?? 0) : s), 0);
    if (first) {
      const end = dayKey(new Date().toISOString());
      for (let t = new Date(first + "T00:00:00"); dayKey(t.toISOString()) <= end; t.setDate(t.getDate() + 1)) {
        const k = dayKey(t.toISOString());
        cum += perDay.get(k) ?? 0;
        out.push({ key: k, cum });
      }
    }
    const delta = prevSum > 0 ? ((inSum - prevSum) / prevSum) * 100 : inSum > 0 ? 100 : 0;
    return { days: out, delta };
  }, [rows, range]);

  // layout
  const PAD = { l: 34, r: 8, t: 10, b: 20 };
  const iw = Math.max(10, w - PAD.l - PAD.r);
  const ih = Math.max(10, h - PAD.t - PAD.b);
  const maxY = Math.max(cap * 1.1, ...days.map((d) => d.cum), 1);
  const x = (i: number) => PAD.l + (days.length <= 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / maxY) * ih;

  const pts: [number, number][] = days.map((d, i) => [x(i), y(d.cum)]);
  const line = smoothPath(pts);
  const area = line ? `${line}L${pts.at(-1)?.[0]},${y(0)}L${pts[0]?.[0]},${y(0)}Z` : "";
  const capY = y(cap);
  const ticks = [0, 0.5, 1].map((t) => t * maxY);
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <div className="bento spend-trend">
      <div className="bento-head">
        <div>
          <h3 className="bento-title">Spending this month</h3>
          <div>
            <span className="bento-total">{money(shownTotal)}</span>
            <span className={`bento-delta ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
              {delta > 0 ? "↑" : delta < 0 ? "↓" : "—"} {Math.abs(Math.round(delta))}%
            </span>
          </div>
        </div>
        <div className="range-pills" role="group" aria-label="Time range">
          {(["week", "month", "all"] as const).map((r) => (
            <button
              key={r}
              className={range === r ? "active" : ""}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
            >
              {r === "week" ? "Week" : r === "month" ? "Month" : "All"}
            </button>
          ))}
        </div>
      </div>
      <div className="bento-chart" ref={ref}>
        {w > 0 && (
          <svg
            width={w}
            height={h}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = e.clientX - rect.left;
              let best = 0;
              let bd = Infinity;
              pts.forEach(([pxv], i) => {
                const d = Math.abs(pxv - px);
                if (d < bd) {
                  bd = d;
                  best = i;
                }
              });
              setHover(best);
            }}
          >
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--tide)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--tide)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} />
                <text className="axis-label" x={0} y={y(t) + 4}>{axisMoney(t)}</text>
              </g>
            ))}
            {cap > 0 && (
              <>
                <line className="cap-line" x1={PAD.l} x2={w - PAD.r} y1={capY} y2={capY} />
                <text className="cap-label" x={w - PAD.r} y={capY - 5} textAnchor="end">
                  Monthly cap
                </text>
              </>
            )}
            {area && <path className="area-fade" d={area} fill="url(#trendFill)" />}
            {line && <path className="series-line" d={line} />}
            {days.map((d, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={d.key}
                  className="axis-label"
                  x={x(i)}
                  y={h - 4}
                  textAnchor={i === 0 ? "start" : i > days.length - labelEvery ? "end" : "middle"}
                >
                  {dayOf(d.key + "T12:00:00")}
                </text>
              ) : null
            )}
            {hover != null && pts[hover] && (
              <>
                <circle className="hover-glow" cx={pts[hover][0]} cy={pts[hover][1]} r={10} />
                <circle className="hover-ring" cx={pts[hover][0]} cy={pts[hover][1]} r={5} />
              </>
            )}
          </svg>
        )}
        {hover != null && pts[hover] && (
          <div className="chart-tip" style={{ left: pts[hover][0], top: pts[hover][1] - 8 }}>
            <span className="tip-date">{dayOf(days[hover].key + "T12:00:00")}</span>
            <span className="tip-amt">{money(days[hover].cum)}</span>
          </div>
        )}
      </div>
      <div className="legend-pills">
        <span className="lp"><i style={{ background: "var(--tide)" }} />Spent</span>
        <span className="lp"><i style={{ background: "var(--danger)" }} />Monthly cap</span>
      </div>
    </div>
  );
}

/* ---------- Fun money card ---------- */

function FunMoney(params: Ctx) {
  const rows = useRows(params);
  const cap = rows[0]?.monthlyCap ?? 0;
  const spent = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
  const ratio = cap > 0 ? spent / cap : 0;
  const state = stateForRatio(ratio);

  return (
    <div className="funmoney">
      <h3 className="bento-title">Fun money</h3>
      <span className="fm-mascot">
        <PufferGauge ratio={ratio} size={72} />
      </span>
      <div className="fm-amount">
        ${spent % 1 === 0 ? spent.toFixed(0) : spent.toFixed(2)}{" "}
        <span className="of">of ${cap % 1 === 0 ? cap.toFixed(0) : cap.toFixed(2)}</span>
      </div>
      <LeashBar ratio={ratio} width={26} />
      <div className="fm-state">
        {Math.min(100, Math.round(ratio * 100))}% — {STATE_LABELS[state]}
      </div>
      <div className="fm-actions">
        <Link className="primary" href="/">Ask Puffr</Link>
        <Link className="ghost" href="/policy">Edit rules</Link>
      </div>
    </div>
  );
}

/* ---------- Recent activity ---------- */

function Recent(params: Ctx) {
  const rows = useRows(params);
  const latest = useMemo(
    () => [...rows].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 5),
    [rows]
  );

  const viewAll = () => {
    const widgets = document.querySelectorAll(".ag-studio-widget");
    widgets[widgets.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="bento">
      <div className="bento-head">
        <h3 className="bento-title">Recent activity</h3>
        <button className="recent-viewall" onClick={viewAll}>View all</button>
      </div>
      <div className="recent-list">
        {latest.map((r) => (
          <div className="recent-row" key={r.ref}>
            {r.imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="recent-thumb" src={r.imageUrl} alt="" />
            ) : (
              <span className="recent-thumb letter" aria-hidden="true">
                {r.title?.[0]?.toUpperCase() ?? "?"}
              </span>
            )}
            <span className="recent-meta">
              <span className="t">{r.title}</span>
              <span className="s">{timeOf(r.createdAt)}</span>
            </span>
            <span className="recent-right">
              <span className="a">{money(r.amount)}</span>
              <span
                className="lp"
                style={{
                  fontSize: 11,
                  color: STATUS_COLORS[r.status] ?? "var(--ink-soft)",
                  border: "none",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <i
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: STATUS_COLORS[r.status] ?? "var(--ink-soft)",
                    display: "inline-block",
                  }}
                />
                {STATUS_LABEL[r.status] ?? r.status}
              </span>
            </span>
          </div>
        ))}
        {latest.length === 0 && <p className="muted">Nothing yet.</p>}
      </div>
    </div>
  );
}

/* ---------- KPI tile row ---------- */

function KpiRow(params: Ctx) {
  const rows = useRows(params);
  const cap = rows[0]?.monthlyCap ?? 0;
  const spent = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
  const kept = rows.reduce((s, r) => s + (r.blocked ? r.amount : 0), 0);
  const waiting = rows.reduce((s, r) => s + (r.waiting ?? 0), 0);

  const keptC = useCountUp(Math.round(kept * 100));
  const spentC = useCountUp(Math.round(spent * 100));
  const reqC = useCountUp(rows.length);
  const waitC = useCountUp(waiting);
  void cap;

  const tiles = [
    { label: "Kept by the leash", value: fmtDollars(keptC), lead: true },
    { label: "Spent", value: fmtDollars(spentC) },
    { label: "Requests", value: String(reqC) },
    { label: "Waiting on you", value: String(waitC) },
  ];

  return (
    <div className="kpi-row">
      {tiles.map((t) => (
        <div className={`kpi-tile${t.lead ? " lead" : ""}`} key={t.label}>
          <span className="kpi-label">{t.label}</span>
          <span className="kpi-value">{t.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Spend by day ---------- */

function SpendByDay(params: Ctx) {
  const rows = useRows(params);
  const [hover, setHover] = useState<number | null>(null);
  const [ref, { w, h }] = useSize<HTMLDivElement>();

  const days = useMemo(() => {
    const perDay = new Map<string, number>();
    const cutoff = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
    for (const r of rows) {
      const k = dayKey(r.createdAt);
      if (k >= cutoff) perDay.set(k, (perDay.get(k) ?? 0) + (r.spent ?? 0));
    }
    const out: { key: string; v: number }[] = [];
    const end = dayKey(new Date().toISOString());
    for (let t = new Date(cutoff + "T00:00:00"); dayKey(t.toISOString()) <= end; t.setDate(t.getDate() + 1)) {
      const k = dayKey(t.toISOString());
      out.push({ key: k, v: perDay.get(k) ?? 0 });
    }
    return out;
  }, [rows]);

  const PAD = { l: 34, r: 8, t: 12, b: 20 };
  const iw = Math.max(10, w - PAD.l - PAD.r);
  const ih = Math.max(10, h - PAD.t - PAD.b);
  const maxV = Math.max(...days.map((d) => d.v), 1);
  const maxIdx = days.findIndex((d) => d.v === Math.max(...days.map((x) => x.v)));
  const slot = iw / days.length;
  const bw = Math.min(34, slot * 0.62);
  const ticks = [0, 0.5, 1].map((t) => t * maxV);

  return (
    <div className="bento">
      <div className="bento-head">
        <h3 className="bento-title">Spend by day</h3>
      </div>
      <div className="bento-chart" ref={ref}>
        {w > 0 && (
          <svg
            width={w}
            height={h}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.floor((e.clientX - rect.left - PAD.l) / slot);
              setHover(i >= 0 && i < days.length ? i : null);
            }}
          >
            <defs>
              <linearGradient id="barMax" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--tide)" />
                <stop offset="100%" stopColor="var(--deep)" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={PAD.l} x2={w - PAD.r} y1={PAD.t + ih - (t / maxV) * ih} y2={PAD.t + ih - (t / maxV) * ih} />
                <text className="axis-label" x={0} y={PAD.t + ih - (t / maxV) * ih + 4}>{axisMoney(t)}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const bh = Math.max(2, (d.v / maxV) * ih);
              const bx = PAD.l + i * slot + (slot - bw) / 2;
              const by = PAD.t + ih - bh;
              const isMax = i === maxIdx && d.v > 0;
              return (
                <g key={d.key}>
                  <rect
                    className="bar"
                    x={bx}
                    y={by}
                    width={bw}
                    height={bh}
                    fill={isMax ? "url(#barMax)" : "var(--ink-soft)"}
                    opacity={isMax ? 1 : hover === i ? 0.85 : 0.4}
                    style={{ animationDelay: `${i * 30}ms` }}
                  />
                  {(i % 3 === 0 || i === days.length - 1) && (
                    <text className="axis-label" x={bx + bw / 2} y={h - 4} textAnchor="middle">
                      {dayOf(d.key + "T12:00:00")}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hover != null && days[hover] && (
          <div
            className="chart-tip"
            style={{
              left: PAD.l + hover * slot + slot / 2,
              top: PAD.t + ih - (days[hover].v / maxV) * ih - 8,
            }}
          >
            <span className="tip-date">{dayOf(days[hover].key + "T12:00:00")}</span>
            <span className="tip-amt">{money(days[hover].v)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Requests by status ---------- */

function StatusBars(params: Ctx) {
  const rows = useRows(params);
  const order = ["PURCHASED", "WAITING", "BLOCKED", "REJECTED"];
  const counts = order.map((s) => ({
    status: s,
    n: rows.filter((r) => r.status === s).length,
    amt: rows.filter((r) => r.status === s).reduce((a, r) => a + r.amount, 0),
  }));
  const max = Math.max(...counts.map((c) => c.n), 1);

  return (
    <div className="bento">
      <div className="bento-head">
        <h3 className="bento-title">Requests by status</h3>
      </div>
      <div className="statusbars">
        {counts.map((c) => (
          <div className="statusbar-row" key={c.status}>
            <span className="statusbar-name">{STATUS_LABEL[c.status]}</span>
            <span className="statusbar-track">
              <span
                className="statusbar-fill"
                style={{
                  width: `${(c.n / max) * 100}%`,
                  background: STATUS_COLORS[c.status],
                }}
              />
            </span>
            <span className="statusbar-num">
              {c.n} · {money(c.amt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- registration ---------- */

const def = <T extends AgWidgetData<Record<string, never>, AgWidgetDataFormat<unknown>>>(
  d: AgWidgetDefinition<string, T>
) => d;

export const W_SPEND_TREND = "spend-trend";
export const W_FUN_MONEY = "fun-money";
export const W_RECENT = "recent-activity";
export const W_KPI_ROW = "kpi-row";
export const W_SPEND_DAY = "spend-by-day";
export const W_STATUS_BARS = "status-bars";

type D = AgWidgetData<Record<string, never>, AgWidgetDataFormat<unknown>>;

export const bentoWidgetDefs = [
  def<D>({
    id: W_SPEND_TREND,
    label: "Spending this month",
    comp: SpendTrend as never,
    form: noMap as never,
    defaultSize: { width: 640, height: 320 },
    minSize: { width: 280, height: 220 },
  }),
  def<D>({
    id: W_FUN_MONEY,
    label: "Fun money",
    comp: FunMoney as never,
    form: noMap as never,
    defaultSize: { width: 300, height: 300 },
    minSize: { width: 240, height: 240 },
  }),
  def<D>({
    id: W_RECENT,
    label: "Recent activity",
    comp: Recent as never,
    form: noMap as never,
    defaultSize: { width: 300, height: 300 },
    minSize: { width: 240, height: 200 },
  }),
  def<D>({
    id: W_KPI_ROW,
    label: "Budget tiles",
    comp: KpiRow as never,
    form: noMap as never,
    defaultSize: { width: 900, height: 110 },
    minSize: { width: 300, height: 90 },
  }),
  def<D>({
    id: W_SPEND_DAY,
    label: "Spend by day",
    comp: SpendByDay as never,
    form: noMap as never,
    defaultSize: { width: 460, height: 260 },
    minSize: { width: 240, height: 180 },
  }),
  def<D>({
    id: W_STATUS_BARS,
    label: "Requests by status",
    comp: StatusBars as never,
    form: noMap as never,
    defaultSize: { width: 460, height: 260 },
    minSize: { width: 240, height: 180 },
  }),
];
