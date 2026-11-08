"use client";

// Custom Studio widgets that make up the Activity bento layout — the hero
// pieces of the reference dashboard that Studio's built-in charts can't draw:
// the "Spending this month" stepped area chart, the Fun money card, the
// Recent activity list, the KPI tile row, stacked "Spend by day" bars, the
// status pill bars, and the grid pager. All read rows from Studio's
// `context` (the DashboardData); the pager writes the grid's widget filter.

import Link from "next/link";
import { useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClassParams,
  type RowClickedEvent,
} from "ag-grid-community";
import type { AgWidgetDefinition } from "ag-studio-react";
import type {
  AgFilterState,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetParams,
} from "ag-studio";
import type { DashboardData } from "@/lib/dashboard-data";
import { PufferGauge, STATE_LABELS, stateForRatio } from "@/components/PufferGauge";
import { StatusBadge } from "@/components/StatusBadge";
import {
  STATUSES,
  activeStatusKey,
  isStatusFilterEntry,
  statusFilterEntries,
  statusKey,
  type StatusKey,
} from "@/lib/status";
import { fmtDollars, useCountUp } from "@/lib/ui";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = DashboardData["requests"][number];
type Ctx = AgWidgetParams<AgWidgetData<Record<string, never>, AgWidgetDataFormat<unknown>>>;

const useRows = (params: Ctx): Row[] =>
  (params.context as { data?: DashboardData })?.data?.requests ?? [];

/* ---------- page-filter plumbing ---------- */

// `pages[].filter.page` is the cross-widget filter slot — the Ask box writes
// it and Studio applies it to its own widgets (the purchases grid). Custom
// widgets read raw context, so they evaluate the same entries client-side.
const usePageFilters = (params: Ctx): AgFilterState[] => {
  const st = params.api.getState();
  const page = st.pages.find((p) => p.id === st.selectedPageId);
  return (page?.filter?.page ?? []) as AgFilterState[];
};

const reqField = (id: string | undefined) =>
  id?.startsWith("requests.") ? id.slice("requests.".length) : null;

const ci = (v: unknown) => String(v ?? "").toLowerCase();
const numOrDate = (v: unknown): number => {
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  const n = Number(s);
  return s.trim() !== "" && !Number.isNaN(n) ? n : Date.parse(s);
};

function matchCell(raw: unknown, op?: string, v?: unknown): boolean {
  switch (op) {
    case "equals":
      return typeof raw === "number" ? numOrDate(v) === raw : ci(raw) === ci(v);
    case "notEqual":
      return typeof raw === "number" ? numOrDate(v) !== raw : ci(raw) !== ci(v);
    case "contains":
      return ci(raw).includes(ci(v));
    case "notContains":
      return !ci(raw).includes(ci(v));
    case "greaterThan":
      return numOrDate(raw) > numOrDate(v);
    case "greaterThanOrEqual":
      return numOrDate(raw) >= numOrDate(v);
    case "lessThan":
      return numOrDate(raw) < numOrDate(v);
    case "lessThanOrEqual":
      return numOrDate(raw) <= numOrDate(v);
    default:
      return true;
  }
}

function applyPageFilters(rows: Row[], filters: AgFilterState[]): Row[] {
  let out = rows;
  for (const f of filters) {
    const key = reqField(f?.field?.id);
    if (!key) continue;
    const model = f?.model as { operator?: string; value?: unknown } | undefined;
    out = out.filter((r) =>
      matchCell((r as Record<string, unknown>)[key], model?.operator, model?.value)
    );
  }
  return out;
}

const useFilteredRows = (params: Ctx): Row[] =>
  applyPageFilters(useRows(params), usePageFilters(params));

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
const fmtKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayKey = () => fmtKey(new Date());
const money = (v: number) => `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
// Axis ticks always round to whole dollars: '$200', never '$200.00'.
const axisMoney = (v: number) => `$${Math.round(v)}`;

/* ---------- svg helpers ---------- */

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

/* ---------- Spending this month: stepped cumulative area + range pills ---------- */

type RangeKey = "week" | "month" | "all";

// Each range's x domain: week = trailing 7 days, month = the full calendar
// month (1st -> last day), all = first spend -> today.
function rangeDomain(range: RangeKey, firstSpendKey: string): [string, string] {
  const today = todayKey();
  if (range === "week") {
    const start = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    return [start, today];
  }
  if (range === "month") {
    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const end = fmtKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    return [start, end];
  }
  return [firstSpendKey || today, today];
}

const eachDay = function* (from: string, to: string) {
  for (let t = new Date(from + "T00:00:00"); fmtKey(t) <= to; t.setDate(t.getDate() + 1)) {
    yield fmtKey(t);
  }
};

function SpendTrend(params: Ctx) {
  const rows = useFilteredRows(params);
  const [range, setRange] = useState<RangeKey>("month");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, { w, h }] = useSize<HTMLDivElement>();

  const cap = rows[0]?.monthlyCap ?? 0;
  const spentTotal = useMemo(() => rows.reduce((s, r) => s + (r.spent ?? 0), 0), [rows]);
  const shownTotal = useCountUp(Math.round(spentTotal * 100)) / 100;

  const { days } = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const r of rows) {
      const k = dayKey(r.createdAt);
      perDay.set(k, (perDay.get(k) ?? 0) + (r.spent ?? 0));
    }
    const keys = [...perDay.keys()].sort();
    const [from, to] = rangeDomain(range, keys[0] ?? "");
    // Carry spend before the domain in so the cumulative line stays a total.
    let cum = rows.reduce((s, r) => (dayKey(r.createdAt) < from ? s + (r.spent ?? 0) : s), 0);
    const today = todayKey();
    const out: { key: string; cum: number }[] = [];
    for (const k of eachDay(from, to)) {
      cum += perDay.get(k) ?? 0;
      // The line ends at today — the axis still runs to the month's end.
      if (k <= today) out.push({ key: k, cum });
    }
    return { days: out, domain: [from, to] as const };
  }, [rows, range]);

  // layout
  const PAD = { l: 34, r: 8, t: 10, b: 20 };
  const iw = Math.max(10, w - PAD.l - PAD.r);
  const ih = Math.max(10, h - PAD.t - PAD.b);
  const maxY = Math.max(cap * 1.1, ...days.map((d) => d.cum), 1);
  // X position comes from the date's place in the domain, not the point index,
  // so days before today sit left of the month-end edge.
  const [domFrom, domTo] = rangeDomain(range, days[0]?.key ?? "");
  const domKeys = [...eachDay(domFrom, domTo)];
  const domIndex = new Map(domKeys.map((k, i) => [k, i]));
  const x = (key: string) => PAD.l + ((domIndex.get(key) ?? 0) / Math.max(1, domKeys.length - 1)) * iw;
  const y = (v: number) => PAD.t + ih - (v / maxY) * ih;
  // Axis labels anchor to the domain (1st .. last day), not the data points.
  const labelIdx = [0, Math.floor(domKeys.length / 2), domKeys.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  const pts: [number, number][] = days.map((d) => [x(d.key), y(d.cum)]);
  // Step-after: hold each cumulative value across the day, jump at the next.
  const line = pts.length
    ? pts.reduce((d, [px, py], i) => (i === 0 ? `M${px},${py}` : `${d}H${px}V${py}`), "")
    : "";
  const area = line ? `${line}V${y(0)}H${pts[0]?.[0]}Z` : "";
  const capY = y(cap);
  const ticks = [0, 0.5, 1].map((t) => t * maxY);

  const left = cap - spentTotal;
  const capChip =
    cap <= 0
      ? null
      : left >= 0
        ? `${money(left)} left of ${money(cap)}`
        : `${money(-left)} over ${money(cap)}`;

  return (
    <div className="bento spend-trend">
      <div className="bento-head">
        <div>
          <h3 className="bento-title">Spending this month</h3>
          <div>
            <span className="bento-total">{money(shownTotal)}</span>
            {capChip && <span className="bento-delta flat">{capChip}</span>}
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
                <stop offset="0%" stopColor="var(--tide)" stopOpacity="0.6" />
                <stop offset="55%" stopColor="var(--deep)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--deep)" stopOpacity="0" />
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
            {labelIdx.map((i, n) => (
              <text
                key={domKeys[i]}
                className="axis-label"
                x={x(domKeys[i])}
                y={h - 4}
                textAnchor={n === 0 ? "start" : n === labelIdx.length - 1 ? "end" : "middle"}
              >
                {dayOf(domKeys[i] + "T12:00:00")}
              </text>
            ))}
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

function FunMoneyBody({ rows }: { rows: Row[] }) {
  const cap = rows[0]?.monthlyCap ?? 0;
  const spent = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
  const ratio = cap > 0 ? spent / cap : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const state = stateForRatio(ratio);

  const mascotRef = useRef<HTMLSpanElement>(null);

  // The mascot drifts around its card like a fish in a tank, bouncing off the
  // card's side walls, the head bottom, and the top of the budget bar. Layout
  // position stays put — we only animate transform — so nothing reflows.
  useEffect(() => {
    const mascot = mascotRef.current;
    const card = mascot?.closest<HTMLElement>(".funmoney");
    const head = card?.querySelector<HTMLElement>(".fm-head");
    const bar = card?.querySelector<HTMLElement>(".fm-bar");
    const img = mascot?.querySelector<HTMLElement>("img.art");
    if (!mascot || !card || !head || !bar) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let pos = { x: 0, y: 0 };
    let vel = { x: 60, y: 45 };
    let flipped = false;
    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Displacement bounds derived from the mascot's transform-free home
      // position. The gauge box pads the art ~1.5x for fx, so the bounds use
      // the art's edge — the fish visibly touches the walls and the bar.
      const cardR = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const headB = head.getBoundingClientRect().bottom - cardR.top + 4;
      const barT = bar.getBoundingClientRect().top - cardR.top - 4;
      const w = mascot.offsetWidth;
      const h = mascot.offsetHeight;
      const inset = img ? (h - img.offsetHeight) / 2 : 0;
      const minX = padL - mascot.offsetLeft - inset;
      const maxX = cardR.width - padR - w - mascot.offsetLeft + inset;
      const minY = headB - mascot.offsetTop - inset;
      const maxY = barT - h - mascot.offsetTop + inset;

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
  }, []);

  return (
    <>
      <div className="bento-head fm-head">
        <h3 className="bento-title">Fish tank money</h3>
      </div>
      <span className="fm-mascot" ref={mascotRef}>
        <PufferGauge ratio={ratio} size={96} showLabel={false} />
      </span>
      <div className="fm-amount">
        {money(spent)} <span className="of">of {money(cap)}</span>
      </div>
      <div className="fm-bar" role="presentation">
        <span className="fm-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="fm-state">
        {pct}% — {STATE_LABELS[state]}
      </div>
      <div className="fm-actions">
        <Link className="primary" href="/">Ask Puffr</Link>
        <Link className="ghost" href="/policy">Edit rules</Link>
      </div>
    </>
  );
}

function FunMoney(params: Ctx) {
  const rows = useFilteredRows(params);
  return (
    <div className="funmoney">
      <FunMoneyBody rows={rows} />
    </div>
  );
}

/* ---------- Recent activity ---------- */

function RecentBody({ rows }: { rows: Row[] }) {
  const latest = useMemo(
    () => [...rows].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 5),
    [rows]
  );

  const viewAll = () => {
    const grid = [...document.querySelectorAll(".ag-studio-layout-widget")].find(
      (w) => w.querySelector(".ag-grid")
    );
    grid?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
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
              <StatusBadge status={r.status} decision={r.decision} />
            </span>
          </div>
        ))}
        {latest.length === 0 && <p className="muted">Nothing yet.</p>}
      </div>
    </>
  );
}

function Recent(params: Ctx) {
  const rows = useFilteredRows(params);
  return (
    <div className="bento">
      <RecentBody rows={rows} />
    </div>
  );
}

/* ---------- Fun money + Recent activity in one tall card ---------- */

function FunRecent(params: Ctx) {
  const rows = useFilteredRows(params);
  return (
    <div className="funmoney funrecent">
      <FunMoneyBody rows={rows} />
      <hr className="fr-sep" />
      <RecentBody rows={rows} />
    </div>
  );
}

/* ---------- KPI tile row ---------- */

function KpiRow(params: Ctx) {
  const rows = useFilteredRows(params);
  const spent = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
  const kept = rows.reduce((s, r) => s + (r.blocked ? r.amount : 0), 0);
  const waiting = rows.reduce((s, r) => s + (r.waiting ?? 0), 0);

  const keptC = useCountUp(Math.round(kept * 100));
  const spentC = useCountUp(Math.round(spent * 100));
  const reqC = useCountUp(rows.length);
  const waitC = useCountUp(waiting);

  const tiles = [
    {
      label: "Kept by the leash",
      value: fmtDollars(keptC),
      helper: "Purchases the rules stopped",
    },
    { label: "Spent", value: fmtDollars(spentC), helper: "Paid via PayPal sandbox" },
    { label: "Requests", value: String(reqC), helper: "Purchase requests made" },
    { label: "Waiting on you", value: String(waitC), helper: "Need your approval" },
  ];

  return (
    <div className="kpi-row">
      {tiles.map((t) => (
        <div className="kpi-tile" key={t.label}>
          <span className="kpi-label">{t.label}</span>
          <span className="kpi-value">{t.value}</span>
          <span className="kpi-helper">{t.helper}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Spend by day ---------- */

function SpendByDay(params: Ctx) {
  const rows = useFilteredRows(params);
  const [hover, setHover] = useState<number | null>(null);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const today = todayKey();

  const days = useMemo(() => {
    const bought = new Map<string, number>();
    const requested = new Map<string, number>();
    const cutoff = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
    for (const r of rows) {
      const k = dayKey(r.createdAt);
      if (k < cutoff) continue;
      if (r.status === "PURCHASED") {
        bought.set(k, (bought.get(k) ?? 0) + r.amount);
      } else {
        requested.set(k, (requested.get(k) ?? 0) + r.amount);
      }
    }
    const out: { key: string; bought: number; requested: number }[] = [];
    for (const k of eachDay(cutoff, today)) {
      out.push({ key: k, bought: bought.get(k) ?? 0, requested: requested.get(k) ?? 0 });
    }
    return out;
  }, [rows, today]);

  const PAD = { l: 34, r: 8, t: 12, b: 20 };
  const iw = Math.max(10, w - PAD.l - PAD.r);
  const ih = Math.max(10, h - PAD.t - PAD.b);
  const maxV = Math.max(...days.map((d) => d.bought + d.requested), 1);
  const slot = iw / days.length;
  const bw = Math.min(34, slot * 0.62);
  const ticks = [0, 0.5, 1].map((t) => t * maxV);
  const yAt = (v: number) => PAD.t + ih - (v / maxV) * ih;

  return (
    <div className="bento">
      <div className="bento-head">
        <h3 className="bento-title">Spend by day</h3>
        <div className="legend-pills">
          <span className="lp"><i className="dot-bought" />Bought</span>
          <span className="lp"><i className="dot-requested" />Requested</span>
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
              const i = Math.floor((e.clientX - rect.left - PAD.l) / slot);
              setHover(i >= 0 && i < days.length ? i : null);
            }}
          >
            <defs>
              <linearGradient id="barBought" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--st-bought)" />
                <stop offset="100%" stopColor="var(--deep)" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={PAD.l} x2={w - PAD.r} y1={yAt(t)} y2={yAt(t)} />
                <text className="axis-label" x={0} y={yAt(t) + 4}>{axisMoney(t)}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const total = d.bought + d.requested;
              const bh = Math.max(0, (d.bought / maxV) * ih);
              const rh = Math.max(0, (d.requested / maxV) * ih);
              const bx = PAD.l + i * slot + (slot - bw) / 2;
              const isToday = d.key === today;
              const dim = !isToday && hover !== i && total > 0;
              return (
                <g key={d.key} opacity={dim ? 0.55 : 1}>
                  {d.bought > 0 && (
                    <rect
                      className="bar"
                      x={bx}
                      y={yAt(d.bought)}
                      width={bw}
                      height={Math.max(2, bh)}
                      fill="url(#barBought)"
                      style={{ animationDelay: `${i * 30}ms` }}
                    />
                  )}
                  {d.requested > 0 && (
                    <rect
                      className="bar bar-requested"
                      x={bx}
                      y={yAt(total)}
                      width={bw}
                      height={Math.max(2, rh)}
                      style={{ animationDelay: `${i * 30}ms` }}
                    />
                  )}
                  {isToday && (
                    <rect
                      className="bar-today"
                      x={bx}
                      y={yAt(total) - 4}
                      width={bw}
                      height={Math.max(4, (total / maxV) * ih + 8)}
                    />
                  )}
                  {(i === days.length - 1 || (i % 3 === 0 && i < days.length - 2)) && (
                    <text className="axis-label" x={bx + bw / 2} y={h - 4} textAnchor="middle">
                      {isToday ? "Today" : dayOf(d.key + "T12:00:00")}
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
              top: yAt(days[hover].bought + days[hover].requested) - 8,
            }}
          >
            <span className="tip-date">{dayOf(days[hover].key + "T12:00:00")}</span>
            <span className="tip-amt">
              {money(days[hover].bought)} bought
              {days[hover].requested > 0 && ` · ${money(days[hover].requested)} requested`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Leash report ---------- */

const useData = (params: Ctx): DashboardData | undefined =>
  (params.context as { data?: DashboardData })?.data;

// One legend row per non-zero canonical status; the badge re-derives the
// display key from status+decision, so PAYPAL stays WAITING/ALLOW underneath.
type LegendRow = {
  key: StatusKey;
  status: string;
  decision: string | null;
  n: number;
  amt: number;
};

// Compact transparent theme — the card's glass surface shows through the grid.
const legendTheme = themeQuartz.withParams({
  backgroundColor: "transparent",
  foregroundColor: "var(--ink)",
  borderColor: "transparent",
  rowHoverColor: "var(--ocean-soft)",
  rowHeight: 32,
  headerHeight: 0,
  fontSize: 12,
  spacing: 4,
  rowBorder: false,
  headerRowBorder: false,
  footerRowBorder: false,
  wrapperBorderRadius: 0,
});

const legendCols: ColDef<LegendRow>[] = [
  {
    field: "status",
    width: 150,
    cellRenderer: (p: ICellRendererParams<LegendRow>) =>
      p.data ? (
        <StatusBadge status={p.data.status} decision={p.data.decision} />
      ) : null,
  },
  {
    field: "n",
    flex: 1,
    cellClass: "leash-col-num",
    cellStyle: { justifyContent: "flex-end" },
  },
  {
    field: "amt",
    flex: 1,
    cellClass: "leash-col-amt",
    cellStyle: { justifyContent: "flex-end" },
    valueFormatter: (p) => money(p.value ?? 0),
  },
];

function LeashReport(params: Ctx) {
  const data = useData(params);
  const rows = data?.requests ?? [];
  const sets = data?.optionSets ?? [];
  const loading = !data;

  // Status cross-filter: the bar/legend select, other widgets (and the grid)
  // react. Active state derives from the live page filter so it mirrors an
  // ask-set status filter too.
  const pageFilters = usePageFilters(params);
  const [active, setActive] = useState<StatusKey | null>(() =>
    activeStatusKey(pageFilters)
  );
  const filtersSig = JSON.stringify(pageFilters);
  useEffect(() => {
    setActive(activeStatusKey(pageFilters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersSig]);

  const toggleStatus = (key: StatusKey) => {
    const st = params.api.getState();
    const current = activeStatusKey(
      (st.pages.find((p) => p.id === st.selectedPageId)?.filter?.page ??
        []) as AgFilterState[]
    );
    const next = current === key ? null : key;
    params.api.setState({
      ...st,
      pages: st.pages.map((pg) =>
        pg.id === st.selectedPageId
          ? {
              ...pg,
              filter: {
                ...pg.filter,
                page: [
                  ...((pg.filter?.page ?? []) as AgFilterState[]).filter(
                    (f) => !isStatusFilterEntry(f)
                  ),
                  ...(next ? statusFilterEntries(next) : []),
                ],
              },
            }
          : pg
      ),
    });
    setActive(next);
  };

  // Carousel layer, per option card: everything Puffr ever put on the stack,
  // including cards the owner X'd out (kept on the payload as `removed`).
  const offered = sets.reduce((a, s) => a + s.options, 0);
  const auto = sets.reduce((a, s) => a + s.autoOk, 0);
  const needs = sets.reduce((a, s) => a + s.needsOk, 0);
  const stopped = sets.reduce((a, s) => a + s.blocked, 0);
  // Per-card outcomes reconcile exactly: offered = picked + skipped + open.
  // Skipped covers X'd-out cards, every card in a dismissed set, and the
  // unchosen rest of a picked set.
  const picked = sets.reduce((a, s) => a + (s.picked ? 1 : 0), 0);
  const open = sets.reduce((a, s) => a + (s.open ? s.live : 0), 0);
  const skipped = offered - picked - open;

  // Pick outcomes, one canonical status per segment — the bar, legend, badges
  // and charts all read the same status config.
  const segs = STATUSES.map((st) => {
    const list = rows.filter((r) => statusKey(r.status, r.decision) === st.key);
    const amt = list.reduce((a, r) => a + r.amount, 0);
    return {
      key: st.key,
      label: st.label,
      color: st.colorVar,
      n: list.length,
      amt,
      tip: `${st.label}: ${list.length} — ${money(amt)}`,
      legend: {
        key: st.key,
        status: st.key === "PAYPAL" ? "WAITING" : st.key,
        decision:
          st.key === "PAYPAL" ? "ALLOW" : st.key === "WAITING" ? "ASK" : null,
        n: list.length,
        amt,
      } as LegendRow,
    };
  }).filter((s) => s.n > 0);
  const totalPicks = segs.reduce((a, s) => a + s.n, 0);
  const ariaBar = segs.map((s) => `${s.label} ${s.n} — ${money(s.amt)}`).join("; ");

  const offeredC = useCountUp(offered, 400);
  const stoppedC = useCountUp(stopped, 400);
  const pickedC = useCountUp(picked, 400);

  return (
    <div className="bento leash">
      <div className="bento-head">
        <h3 className="bento-title">Leash report</h3>
      </div>

      {loading ? (
        <>
          <div className="leash-stats">
            {[0, 1, 2].map((i) => (
              <div key={i} className="leash-stat skeleton" style={{ height: 58 }} />
            ))}
          </div>
          <div className="skeleton" style={{ height: 16, borderRadius: 999 }} />
          <div className="skeleton" style={{ height: 12, width: "70%" }} />
        </>
      ) : sets.length === 0 && rows.length === 0 ? (
        <div className="leash-empty">
          <p>No suggestions yet. Ask Puffr to shop.</p>
        </div>
      ) : (
        <>
          <div className="leash-stats">
            <div className="leash-stat">
              <span className="leash-num">{offeredC}</span>
              <span className="leash-cap">Options offered</span>
            </div>
            <div className="leash-stat hero">
              <svg
                className="leash-shield"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                aria-hidden="true"
              >
                <path
                  d="M7 1.5 11.5 3v3.4c0 3-2 4.9-4.5 6.1C4.5 11.3 2.5 9.4 2.5 6.4V3L7 1.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
                <path
                  d="M4.8 6.7 6.4 8.3 9.3 5.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="leash-num">{stoppedC}</span>
              <span className="leash-cap">Blocked by the rules</span>
            </div>
            <div className="leash-stat">
              <span className="leash-num">{pickedC}</span>
              <span className="leash-cap">Options you picked</span>
            </div>
          </div>

          <div className="leash-outcome">
            <span className="statusbars-label">What happened to your picks</span>
            {totalPicks === 0 ? (
              <div className="leashbar empty" role="img" aria-label="Nothing picked yet">
                <span className="leashbar-empty-text">Nothing picked yet</span>
              </div>
            ) : (
              <>
                <div
                  className="leashbar"
                  role="group"
                  aria-label={`Picks by status: ${ariaBar}`}
                >
                  {segs.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      className={`leash-seg${s.key === active ? " active" : ""}`}
                      aria-pressed={s.key === active}
                      aria-label={`${s.label}: ${s.n} — ${money(s.amt)}. ${
                        s.key === active ? "Clear" : "Apply"
                      } the status filter.`}
                      onClick={() => toggleStatus(s.key)}
                      style={{
                        flexGrow: s.n,
                        minWidth: 10,
                        background: s.color,
                      }}
                    >
                      <span className="leash-tip" role="tooltip">
                        {s.tip}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="leash-legend" aria-label="Purchases by status">
                  <AgGridReact<LegendRow>
                    theme={legendTheme}
                    rowData={segs.map((s) => s.legend)}
                    columnDefs={legendCols}
                    domLayout="autoHeight"
                    headerHeight={0}
                    suppressCellFocus
                    onRowClicked={(e: RowClickedEvent<LegendRow>) =>
                      e.data && toggleStatus(e.data.key)
                    }
                    rowClassRules={{
                      "leash-row-active": (p: RowClassParams<LegendRow>) =>
                        p.data?.key === active,
                    }}
                    getRowId={(p) => p.data.key}
                  />
                </div>
              </>
            )}
          </div>

          <span className="leash-foot">
            {auto} pass · {needs} ask · {stopped} blocked
            {" | "}
            {picked} picked
            {skipped > 0 && ` · ${skipped} skipped`}
            {open > 0 && ` · ${open} still open`}
          </span>
        </>
      )}
    </div>
  );
}

/* ---------- Grid pager ---------- */

// The Studio grid is a server-side row model — no client pagination — so the
// pager slices rows through a widget filter on `rowIdx` (1-based newest-first).
const GRID_ID = "requests-grid";
const ROWIDX = "requests.rowIdx";
const PAGE_SIZE = 8;

const pageFilter = (page: number) => [
  { field: { id: ROWIDX }, model: { operator: "greaterThanOrEqual", value: (page - 1) * PAGE_SIZE + 1 } },
  { field: { id: ROWIDX }, model: { operator: "lessThanOrEqual", value: page * PAGE_SIZE } },
];
export const gridPageFilter = pageFilter;

function GridPager(params: Ctx) {
  const rows = useFilteredRows(params);
  const api = params.api;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [page, setPage] = useState(1);

  const go = (p: number) => {
    const clamped = Math.min(Math.max(1, p), pages);
    setPage(clamped);
    const st = api.getState();
    api.setState({
      ...st,
      pages: st.pages.map((pg) =>
        pg.id === st.selectedPageId
          ? {
              ...pg,
              filter: {
                ...pg.filter,
                widget: {
                  ...pg.filter?.widget,
                  [GRID_ID]: pageFilter(clamped) as never,
                },
              },
            }
          : pg
      ),
    });
  };

  const lo = (page - 1) * PAGE_SIZE + 1;
  const hi = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="grid-pager">
      <span className="grid-pager-info">
        {total === 0 ? "No requests" : `${lo}–${hi} of ${total} requests · ${PAGE_SIZE} per page`}
      </span>
      <div className="grid-pager-nav">
        <button
          className="pager-btn"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>
        <span className="grid-pager-page">
          Page {page} of {pages}
        </span>
        <button
          className="pager-btn"
          onClick={() => go(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
        >
          Next ›
        </button>
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
export const W_FUN_RECENT = "fun-recent";
export const W_RECENT = "recent-activity";
export const W_KPI_ROW = "kpi-row";
export const W_SPEND_DAY = "spend-by-day";
export const W_STATUS_BARS = "status-bars";
export const W_GRID_PAGER = "grid-pager";

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
    defaultSize: { width: 300, height: 340 },
    minSize: { width: 240, height: 300 },
  }),
  def<D>({
    id: W_FUN_RECENT,
    label: "Fun money + recent",
    comp: FunRecent as never,
    form: noMap as never,
    defaultSize: { width: 300, height: 780 },
    minSize: { width: 240, height: 640 },
  }),
  def<D>({
    id: W_RECENT,
    label: "Recent activity",
    comp: Recent as never,
    form: noMap as never,
    defaultSize: { width: 340, height: 560 },
    minSize: { width: 280, height: 480 },
  }),
  def<D>({
    id: W_KPI_ROW,
    label: "Budget tiles",
    comp: KpiRow as never,
    form: noMap as never,
    defaultSize: { width: 900, height: 130 },
    minSize: { width: 300, height: 110 },
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
    label: "Leash report",
    comp: LeashReport as never,
    form: noMap as never,
    defaultSize: { width: 460, height: 260 },
    minSize: { width: 240, height: 400 },
  }),
  def<D>({
    id: W_GRID_PAGER,
    label: "Grid pages",
    comp: GridPager as never,
    form: noMap as never,
    defaultSize: { width: 900, height: 48 },
    minSize: { width: 240, height: 40 },
  }),
];
