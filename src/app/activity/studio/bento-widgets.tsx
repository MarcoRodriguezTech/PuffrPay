"use client";

// Custom Studio widgets that make up the Activity bento layout — the hero
// pieces of the reference dashboard that Studio's built-in charts can't draw:
// the "Spending this month" stepped area chart, the Fun money card, the
// Recent activity list, the KPI tile row, stacked "Spend by day" bars, the
// status pill bars, and the grid pager. All read rows from Studio's
// `context` (the DashboardData); the pager writes the grid's widget filter.

import Link from "next/link";
import { useMemo, useRef, useState, useLayoutEffect } from "react";
import type { AgWidgetDefinition } from "ag-studio-react";
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import type { DashboardData } from "@/lib/dashboard-data";
import { PufferGauge, STATE_LABELS, stateForRatio } from "@/components/PufferGauge";
import { LeashBar } from "@/components/LeashBar";
import { StatusBadge, STATUS_COLORS, statusKey, type StatusKey } from "@/components/StatusBadge";
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
const fmtKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayKey = () => fmtKey(new Date());
const money = (v: number) => `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
// Axis ticks always round to whole dollars: '$200', never '$200.00'.
const axisMoney = (v: number) => `$${Math.round(v)}`;

const STATUS_ORDER: StatusKey[] = ["PURCHASED", "PAYPAL", "WAITING", "BLOCKED", "REJECTED", "FAILED"];

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
  const rows = useRows(params);
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

function FunMoney(params: Ctx) {
  const rows = useRows(params);
  const cap = rows[0]?.monthlyCap ?? 0;
  const spent = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
  const ratio = cap > 0 ? spent / cap : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const state = stateForRatio(ratio);

  return (
    <div className="funmoney">
      <div className="bento-head fm-head">
        <h3 className="bento-title">Fun money</h3>
        <span className="fm-leash-pill" aria-hidden="true">
          <LeashBar ratio={ratio} width={10} />
        </span>
      </div>
      <span className="fm-mascot">
        <PufferGauge ratio={ratio} size={150} showLabel={false} />
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
    const grid = [...document.querySelectorAll(".ag-studio-layout-widget")].find(
      (w) => w.querySelector(".ag-grid")
    );
    grid?.scrollIntoView({ behavior: "smooth", block: "start" });
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
              <StatusBadge status={r.status} decision={r.decision} />
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
  const rows = useRows(params);
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
                <stop offset="0%" stopColor="var(--tide)" />
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

/* ---------- Requests by status ---------- */

function StatusBars(params: Ctx) {
  const rows = useRows(params);
  const counts = STATUS_ORDER.map((key) => ({
    key,
    n: rows.filter((r) => statusKey(r.status, r.decision) === key).length,
    amt: rows
      .filter((r) => statusKey(r.status, r.decision) === key)
      .reduce((a, r) => a + r.amount, 0),
  })).filter((c) => c.n > 0 || c.key === "PURCHASED");
  const max = Math.max(...counts.map((c) => c.n), 1);
  const NAME: Record<StatusKey, string> = {
    PURCHASED: "Bought",
    PAYPAL: "Awaiting PayPal",
    WAITING: "Waiting for you",
    BLOCKED: "Blocked",
    REJECTED: "Rejected",
    FAILED: "Failed",
  };

  return (
    <div className="bento">
      <div className="bento-head">
        <div>
          <h3 className="bento-title">Requests by status</h3>
          <p className="bento-sub">Count and amount</p>
        </div>
      </div>
      <div className="statusbars">
        {counts.map((c) => (
          <div className="statusbar-row" key={c.key}>
            <span className="statusbar-name">{NAME[c.key]}</span>
            <span className="statusbar-track">
              <span
                className="statusbar-fill"
                style={{
                  width: `${(c.n / max) * 100}%`,
                  background: STATUS_COLORS[c.key],
                }}
              />
            </span>
            <span className="statusbar-num">
              {c.n} — {money(c.amt)}
            </span>
          </div>
        ))}
      </div>
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
  const rows = useRows(params);
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
    label: "Requests by status",
    comp: StatusBars as never,
    form: noMap as never,
    defaultSize: { width: 460, height: 260 },
    minSize: { width: 240, height: 180 },
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
