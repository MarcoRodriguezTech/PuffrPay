"use client";

// Custom Studio widgets that make up the Activity bento layout — the hero
// pieces of the reference dashboard that Studio's built-in charts can't draw:
// the "Spending this month" stepped area chart, the Fun money card, the
// Recent activity list, the KPI tile row, stacked "Spend by day" bars, the
// status pill bars, and the grid pager. All read rows from Studio's
// `context` (the DashboardData); the pager writes the grid's widget filter.

import Link from "next/link";
import { useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
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
import { OptBadge, StatusBadge } from "@/components/StatusBadge";
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

/* Hover tooltips portal to <body> at fixed coordinates — Studio's widget
   chrome clips overflow, so an in-chart tip gets cut at the card edge. */
function ChartTip({
  chartRef,
  x,
  y,
  children,
}: {
  chartRef: React.RefObject<HTMLElement | null>;
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  const rect = chartRef.current?.getBoundingClientRect();
  if (!rect) return null;
  return createPortal(
    <div className="chart-tip" style={{ left: rect.left + x, top: rect.top + y }}>
      {children}
    </div>,
    document.body,
  );
}

/* Same clipping problem on the leash bar: stat/segment tips were in-DOM
   spans and Studio's overflow-hidden chrome cut them at the card edge.
   Portal to <body> anchored on the trigger's rect — `below` hangs the tip
   under the anchor (stat tiles keep their downward direction). */
function HoverTip({
  anchor,
  below,
  children,
}: {
  anchor: HTMLElement;
  below?: boolean;
  children: React.ReactNode;
}) {
  const r = anchor.getBoundingClientRect();
  return createPortal(
    <div
      role="tooltip"
      className={`chart-tip${below ? " tip-below" : ""}`}
      style={{ left: r.left + r.width / 2, top: below ? r.bottom : r.top }}
    >
      {children}
    </div>,
    document.body,
  );
}

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
    case "isNull":
      return raw === null || raw === undefined;
    case "isNotNull":
      return raw !== null && raw !== undefined;
    default:
      return true;
  }
}

function applyPageFilters<T>(rows: T[], filters: AgFilterState[]): T[] {
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

// status:false strips the outcome filter family (status/decision/hasOrder)
// for budget-state widgets — a status click drills the lists, not the
// gauges. Other page filters (date, category, ask-set) still apply.
const useEffectiveFilters = (params: Ctx, status: boolean): AgFilterState[] => {
  const filters = usePageFilters(params);
  return status ? filters : filters.filter((f) => !isStatusFilterEntry(f));
};

const useFilteredRows = (params: Ctx, opts?: { status?: boolean }): Row[] =>
  applyPageFilters(
    useRows(params),
    useEffectiveFilters(params, opts?.status !== false)
  );

// The merged ledger (requests + offered/skipped cards) the grid table and
// its pager count over — `useFilteredRows` stays request-scope for metrics.
type ActivityRow = NonNullable<DashboardData>["activity"][number];
const useActivity = (params: Ctx): ActivityRow[] =>
  (params.context as { data?: DashboardData })?.data?.activity ?? [];
const useFilteredActivity = (params: Ctx): ActivityRow[] =>
  applyPageFilters(useActivity(params), usePageFilters(params));

// Feed cards honor the same page filters — their `status` field shares
// values with request statuses, plus card-only OFFERED/SKIPPED extras.
const useFilteredCards = (params: Ctx, opts?: { status?: boolean }): CardRow[] =>
  applyPageFilters(
    (params.context as { data?: DashboardData })?.data?.cards ?? [],
    useEffectiveFilters(params, opts?.status !== false)
  );

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
const money = (v: number) =>
  `$${v.toLocaleString("en-US", {
    minimumFractionDigits: v % 1 === 0 ? 0 : 2,
    maximumFractionDigits: v % 1 === 0 ? 0 : 2,
  })}`;
// Axis ticks always round to whole dollars: '$200', never '$200.00'.
const axisMoney = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

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
  const rows = useFilteredRows(params, { status: false });
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
          <ChartTip chartRef={ref} x={pts[hover][0]} y={pts[hover][1] - 8}>
            <span className="tip-date">{dayOf(days[hover].key + "T12:00:00")}</span>
            <span className="tip-amt">{money(days[hover].cum)}</span>
          </ChartTip>
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
  // position stays put — we only animate `translate` — so nothing reflows.
  //
  // A constant-speed bounce is a triangle wave on each axis, so it runs as
  // Web Animations instead of a per-frame JS loop: linear back-and-forth on
  // X (outer span) and Y (inner gauge), plus a flip of the art at every X
  // turnaround. These run on the compositor — no main-thread work per frame,
  // where the old rAF loop drove a full style/paint pass at display rate.
  useEffect(() => {
    const mascot = mascotRef.current;
    const card = mascot?.closest<HTMLElement>(".funmoney");
    const head = card?.querySelector<HTMLElement>(".fm-head");
    const bar = card?.querySelector<HTMLElement>(".fm-bar");
    const swimY = mascot?.querySelector<HTMLElement>(".puffer");
    const img = mascot?.querySelector<HTMLElement>("img.art");
    if (!mascot || !card || !head || !bar || !swimY) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // px per second — the same speeds as the old loop
    const VX = 60;
    const VY = 45;
    let anims: Animation[] = [];
    let onScreen = true;
    let key = "";

    // Displacement bounds derived from the mascot's transform-free home
    // position. The gauge box pads the art ~1.5x for fx, so the bounds use
    // the art's edge — the fish visibly touches the walls and the bar.
    // Re-measured (and the swim rebuilt) only when something in the card
    // resizes.
    const build = () => {
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

      // Resize callbacks fire for every observed child — skip no-op rebuilds
      // so the fish doesn't restart its path.
      const next = [minX, maxX, minY, maxY].map(Math.round).join();
      if (next === key) return;
      key = next;

      anims.forEach((a) => a.cancel());
      anims = [];
      const loop = { iterations: Infinity, direction: "alternate", easing: "linear" } as const;
      const spanX = maxX - minX;
      if (spanX > 0) {
        const tx = (spanX / VX) * 1000;
        const ax = mascot.animate(
          [{ translate: `${minX}px 0` }, { translate: `${maxX}px 0` }],
          { ...loop, duration: tx }
        );
        // Start from the home position, heading right, like the old loop.
        ax.currentTime = (Math.max(0, Math.min(spanX, -minX)) / spanX) * tx;
        anims.push(ax);
        if (img) {
          // Facing follows the X leg: right-bound half of the cycle unflipped,
          // left-bound half mirrored (the paired 0.5 offsets make it a jump).
          const af = img.animate(
            [
              { scale: "1 1", offset: 0 },
              { scale: "1 1", offset: 0.5 },
              { scale: "-1 1", offset: 0.5 },
              { scale: "-1 1", offset: 1 },
            ],
            { duration: tx * 2, iterations: Infinity, easing: "linear" }
          );
          af.currentTime = ax.currentTime;
          anims.push(af);
        }
      }
      const spanY = maxY - minY;
      if (spanY > 0) {
        const ty = (spanY / VY) * 1000;
        const ay = swimY.animate(
          [{ translate: `0 ${minY}px` }, { translate: `0 ${maxY}px` }],
          { ...loop, duration: ty }
        );
        ay.currentTime = (Math.max(0, Math.min(spanY, -minY)) / spanY) * ty;
        anims.push(ay);
      }
      if (!onScreen) anims.forEach((a) => a.pause());
    };
    build();
    // Any child changing size can move the head/bar edges.
    const ro = new ResizeObserver(build);
    ro.observe(card);
    for (const el of card.children) ro.observe(el);

    // Swim only while the card is on screen; scrolled away, the swim and the
    // gauge's CSS bob/bubble animations pause (hidden tabs pause on their own).
    const io = new IntersectionObserver((entries) => {
      // Entries can arrive batched (e.g. "hidden" while Studio mounts the
      // widget, then "visible") — only the newest one is current.
      onScreen = entries[entries.length - 1].isIntersecting;
      card.classList.toggle("fm-paused", !onScreen);
      anims.forEach((a) => (onScreen ? a.play() : a.pause()));
    });
    io.observe(card);
    return () => {
      anims.forEach((a) => a.cancel());
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <>
      <div className="bento-head fm-head">
        <h3 className="bento-title">
          Fun money — {new Date().toLocaleString("en-US", { month: "long" })}
        </h3>
      </div>
      <span className="fm-mascot" ref={mascotRef}>
        <PufferGauge ratio={ratio} size={96} showLabel={false} />
      </span>
      <div className="fm-amount">
        {money(spent)} <span className="of">/ {money(cap)}</span>
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
  const rows = useFilteredRows(params, { status: false });
  return (
    <div className="funmoney">
      <FunMoneyBody rows={rows} />
    </div>
  );
}

/* ---------- Recent activity ---------- */

type CardRow = NonNullable<DashboardData>["cards"][number];

function RecentBody({ rows, cards }: { rows: Row[]; cards: CardRow[] }) {
  // Requests and offered cards share one newest-first feed — a picked card
  // shows only its request row, so each product lands once.
  const latest = useMemo(
    () =>
      [
        ...rows.map((r) => ({ kind: "req" as const, at: +new Date(r.createdAt), r })),
        ...cards.map((c) => ({ kind: "opt" as const, at: +new Date(c.createdAt), c })),
      ]
        .sort((a, b) => b.at - a.at)
        .slice(0, 5),
    [rows, cards]
  );

  return (
    <>
      <div className="bento-head">
        <h3 className="bento-title">Recent activity</h3>
      </div>
      <div className="recent-list">
        {latest.map((e) => {
          const item = e.kind === "req" ? e.r : e.c;
          return (
            <div className="recent-row" key={`${e.kind}-${item.ref}`}>
              {item.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img className="recent-thumb" src={item.imageUrl} alt="" />
              ) : (
                <span className="recent-thumb letter" aria-hidden="true">
                  {item.title?.[0]?.toUpperCase() ?? "?"}
                </span>
              )}
              <span className="recent-meta">
                <span className="t">{item.title}</span>
                <span className="s">{timeOf(item.createdAt)}</span>
              </span>
              <span className="recent-right">
                <span className="a">{money(item.amount)}</span>
                {e.kind === "req" ? (
                  <StatusBadge
                    status={e.r.status}
                    decision={e.r.decision}
                    hasOrder={e.r.orderId != null}
                  />
                ) : (
                  <OptBadge state={e.c.state} />
                )}
              </span>
            </div>
          );
        })}
        {latest.length === 0 && <p className="muted">Nothing yet.</p>}
      </div>
    </>
  );
}

function Recent(params: Ctx) {
  const rows = useFilteredRows(params);
  const cards = useFilteredCards(params);
  return (
    <div className="bento">
      <RecentBody rows={rows} cards={cards} />
    </div>
  );
}

/* ---------- Fun money + Recent activity in one tall card ---------- */

function FunRecent(params: Ctx) {
  const rows = useFilteredRows(params);
  const rowsGlobal = useFilteredRows(params, { status: false });
  const cards = useFilteredCards(params);
  return (
    <div className="funmoney funrecent">
      <FunMoneyBody rows={rowsGlobal} />
      <hr className="fr-sep" />
      <RecentBody rows={rows} cards={cards} />
    </div>
  );
}

/* ---------- KPI tile row ---------- */

function KpiRow(params: Ctx) {
  const rows = useFilteredRows(params, { status: false });
  const cards = useFilteredCards(params, { status: false });
  const spent = rows.reduce((s, r) => s + (r.spent ?? 0), 0);
  // Everything the rules refused, both layers: picked requests (BLOCKED) plus
  // shelf cards stamped BLOCK — same coverage as the "Blocked by puffr" stat.
  const kept =
    rows.reduce((s, r) => s + (r.blocked ? r.amount : 0), 0) +
    cards.reduce((s, c) => s + (c.blocked ? c.amount : 0), 0);
  const bought = rows.reduce((s, r) => s + (r.purchased ?? 0), 0);

  const keptC = useCountUp(Math.round(kept * 100));
  const spentC = useCountUp(Math.round(spent * 100));
  const reqC = useCountUp(rows.length);
  const boughtC = useCountUp(bought);

  const tiles = [
    { label: "Spent", value: fmtDollars(spentC), helper: "Paid via PayPal sandbox" },
    {
      label: "Kept by the leash",
      value: fmtDollars(keptC),
      helper: "Blocked by your rules",
    },
    { label: "Requests", value: String(reqC), helper: "Purchase requests made" },
    { label: "Bought", value: String(boughtC), helper: "Completed purchases" },
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
  const rows = useFilteredRows(params, { status: false });
  const [hover, setHover] = useState<number | null>(null);
  // Paged 7-day window — 0 = the week ending today, 1 = the week before, ...
  const [weekOffset, setWeekOffset] = useState(0);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const today = todayKey();

  const weekEnd = useMemo(
    () => fmtKey(new Date(Date.now() - weekOffset * 7 * 864e5)),
    [weekOffset]
  );

  const days = useMemo(() => {
    const bought = new Map<string, number>();
    const requested = new Map<string, number>();
    for (const r of rows) {
      const k = dayKey(r.createdAt);
      if (r.status === "PURCHASED") {
        bought.set(k, (bought.get(k) ?? 0) + r.amount);
      } else {
        requested.set(k, (requested.get(k) ?? 0) + r.amount);
      }
    }
    const start = fmtKey(new Date(+new Date(weekEnd + "T12:00:00") - 6 * 864e5));
    const out: { key: string; bought: number; requested: number }[] = [];
    for (const k of eachDay(start, weekEnd)) {
      out.push({ key: k, bought: bought.get(k) ?? 0, requested: requested.get(k) ?? 0 });
    }
    return out;
  }, [rows, weekEnd]);

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
        <div className="wk-nav">
          <button
            type="button"
            className="wk-btn"
            aria-label="Previous 7 days"
            title="Previous 7 days"
            onClick={() => {
              setHover(null);
              setWeekOffset((o) => o + 1);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M7.5 2.5 4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="wk-range">
            {days[0] ? `${dayOf(days[0].key + "T12:00:00")} – ${dayOf(weekEnd + "T12:00:00")}` : ""}
          </span>
          <button
            type="button"
            className="wk-btn"
            aria-label="Next 7 days"
            title="Next 7 days"
            disabled={weekOffset === 0}
            onClick={() => {
              setHover(null);
              setWeekOffset((o) => Math.max(0, o - 1));
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
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
                  <text className="axis-label" x={bx + bw / 2} y={h - 4} textAnchor="middle">
                    {isToday ? "Today" : dayOf(d.key + "T12:00:00")}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {hover != null && days[hover] && (
          <ChartTip
            chartRef={ref}
            x={PAD.l + hover * slot + slot / 2}
            y={yAt(days[hover].bought + days[hover].requested) - 8}
          >
            <span className="tip-date">{dayOf(days[hover].key + "T12:00:00")}</span>
            <span className="tip-amt">
              {money(days[hover].bought)} bought
              {days[hover].requested > 0 && ` · ${money(days[hover].requested)} requested`}
            </span>
          </ChartTip>
        )}
      </div>
    </div>
  );
}

/* ---------- Leash report ---------- */

const useData = (params: Ctx): DashboardData | undefined =>
  (params.context as { data?: DashboardData })?.data;

// One legend row per non-zero canonical status; the badge re-derives the
// display key from status+hasOrder, so PAYPAL stays WAITING underneath.
type LegendRow = {
  key: StatusKey | "SKIPPED";
  status: string;
  hasOrder?: boolean;
  n: number;
  amt: number;
  /** "skipped" renders the shelf OptBadge instead of a request StatusBadge. */
  optState?: "skipped";
};

type Seg = {
  key: StatusKey | "SKIPPED";
  label: string;
  color: string;
  n: number;
  amt: number;
  tip: string;
  legend: LegendRow;
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
    width: 220,
    cellRenderer: (p: ICellRendererParams<LegendRow>) =>
      p.data ? (
        p.data.optState === "skipped" ? (
          <OptBadge state="skipped" />
        ) : (
          <StatusBadge status={p.data.status} hasOrder={p.data.hasOrder} />
        )
      ) : null,
  },
  {
    field: "n",
    flex: 1,
    cellClass: "leash-col-num",
    cellStyle: { textAlign: "right" },
  },
  {
    // narrow fixed amount column — n right-aligns into it, so the pair
    // "8  $184.33" glues together at the row's right edge
    field: "amt",
    width: 88,
    cellClass: "leash-col-amt",
    cellStyle: { textAlign: "left" },
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
  const [active, setActive] = useState<StatusKey | "SKIPPED" | null>(() =>
    activeStatusKey(pageFilters)
  );
  const filtersSig = JSON.stringify(pageFilters);
  useEffect(() => {
    setActive(activeStatusKey(pageFilters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersSig]);

  // One hover slot drives the portaled tip — whichever trigger the pointer
  // is on wins. The isConnected guard clears a tip whose anchor unmounted
  // (e.g. the bar re-rendered while it was showing).
  const [tip, setTip] = useState<{
    el: HTMLElement;
    text: string;
    below?: boolean;
  } | null>(null);
  useEffect(() => {
    if (tip && !tip.el.isConnected) setTip(null);
  }, [tip]);
  const showTip = (below?: boolean) => (e: React.SyntheticEvent<HTMLElement>) =>
    setTip({
      el: e.currentTarget,
      text:
        e.currentTarget.getAttribute("data-tip") ?? "",
      below,
    });

  const toggleStatus = (key: StatusKey | "SKIPPED") => {
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
  // Refused = everything the rules stopped, both layers: cards that never
  // left the shelf + picked requests the policy blocked.
  const stopped =
    sets.reduce((a, s) => a + s.blocked, 0) +
    rows.filter(
      (r) => statusKey(r.status, r.decision, r.orderId != null) === "BLOCKED"
    ).length;
  // Per-card outcomes reconcile exactly: offered = picked + skipped + open.
  // Skipped covers X'd-out cards, every card in a dismissed set, and the
  // unchosen rest of a picked set.
  const picked = sets.reduce((a, s) => a + (s.picked ? 1 : 0), 0);
  const open = sets.reduce((a, s) => a + (s.open ? s.live : 0), 0);

  // Pick outcomes, one canonical status per segment — the bar, legend, badges
  // and charts all read the same status config. Request-layer statuses only:
  // BLOCKED merges into the "Refused" stat above. Skipped is appended
  // separately — it's shelf-layer (offered, never picked) not a request
  // status, but it filters like the rest via the card-only SKIPPED value.
  const segs: Seg[] = STATUSES.filter((st) => st.key !== "BLOCKED").map((st) => {
    const list = rows.filter(
      (r) => statusKey(r.status, r.decision, r.orderId != null) === st.key
    );
    const n = list.length;
    const amt = list.reduce((a, r) => a + r.amount, 0);
    return {
      key: st.key,
      label: st.label,
      color: st.colorVar,
      n,
      amt,
      tip: `${st.label}: ${n} — ${money(amt)}`,
      legend: {
        key: st.key,
        status: st.key === "PAYPAL" ? "WAITING" : st.key,
        hasOrder:
          st.key === "PAYPAL" ? true : st.key === "WAITING" ? false : undefined,
        n,
        amt,
      } as LegendRow,
    };
  });
  // Skipped — cards offered but never picked (X'd out, dismissed sets, the
  // unchosen rest of a picked set). Shelf-layer, not a request status — its
  // filter selects card rows via the SKIPPED status value, which no request
  // row can carry.
  const skippedCards = (data?.cards ?? []).filter((c) => c.state === "skipped");
  const skippedAmt = skippedCards.reduce((a, c) => a + c.amount, 0);
  segs.push({
    key: "SKIPPED",
    label: "Skipped",
    color: "var(--st-skipped)",
    n: skippedCards.length,
    amt: skippedAmt,
    tip: `Skipped: ${skippedCards.length} — ${money(skippedAmt)}`,
    legend: {
      key: "SKIPPED",
      status: "SKIPPED",
      n: skippedCards.length,
      amt: skippedAmt,
      optState: "skipped",
    },
  });
  // The colored bar shows only real counts; the legend lists every status so
  // the vocabulary (e.g. "Waiting for you") is visible even at zero.
  const barSegs = segs.filter((s) => s.n > 0);
  // Failed stays out of the always-on legend — it only matters when real.
  const legendSegs = segs.filter((s) => s.key !== "FAILED");
  const totalPicks = segs.reduce((a, s) => a + s.n, 0);
  const ariaBar = barSegs
    .map((s) => `${s.label} ${s.n} — ${money(s.amt)}`)
    .join("; ");

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
            <button
              type="button"
              // BLOCKED is both layers (shelf cards + picked requests) — the
              // status filter catches both in Recent and the grid.
              className={`leash-stat hero${active === "BLOCKED" ? " active" : ""}`}
              aria-pressed={active === "BLOCKED"}
              aria-label={`Blocked by puffr: ${stopped}. ${
                active === "BLOCKED" ? "Clear" : "Apply"
              } the status filter.`}
              onClick={() => toggleStatus("BLOCKED")}
              data-tip={
                active === "BLOCKED"
                  ? "Clear the filter — show everything"
                  : "Show everything Puffr blocked"
              }
              onMouseEnter={showTip(true)}
              onMouseLeave={() => setTip(null)}
              onFocus={showTip(true)}
              onBlur={() => setTip(null)}
            >
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
              <span className="leash-cap">Blocked by puffr</span>
            </button>
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
                  {barSegs.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      className={`leash-seg${s.key === active ? " active" : ""}`}
                      aria-pressed={s.key === active}
                      aria-label={`${s.label}: ${s.n} — ${money(s.amt)}. ${
                        s.key === active ? "Clear" : "Apply"
                      } the status filter.`}
                      onClick={() => toggleStatus(s.key)}
                      data-tip={s.tip}
                      onMouseEnter={showTip()}
                      onMouseLeave={() => setTip(null)}
                      onFocus={showTip()}
                      onBlur={() => setTip(null)}
                      style={{
                        flexGrow: s.n,
                        minWidth: 10,
                        background: s.color,
                        // also as `color` so the CSS halo can tint itself with
                        // the segment's own status color via currentColor
                        color: s.color,
                      }}
                    />
                  ))}
                </div>
                <div className="leash-legend" aria-label="Purchases by status">
                  <AgGridReact<LegendRow>
                    theme={legendTheme}
                    rowData={legendSegs.map((s) => s.legend)}
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
                      "leash-row-empty": (p: RowClassParams<LegendRow>) =>
                        p.data?.n === 0,
                    }}
                    getRowId={(p) => p.data.key}
                  />
                </div>
              </>
            )}
          </div>

          <span className="leash-foot">
            {offered} offered — {auto} auto-ok · {needs} would-ask · {stopped} refused
            {" → "}
            {picked} picked
            {open > 0 && ` · ${open} still open`}
          </span>
          {tip && (
            <HoverTip anchor={tip.el} below={tip.below}>
              {tip.text}
            </HoverTip>
          )}
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

// First-paint widget filter: page 1 = the newest 8 rows of the unfiltered
// ledger (rowIdx is the merged rank). Once the pager or a page filter is
// involved, `go` re-emits the concrete `isIn` set of the filtered slice —
// a range on absolute rank returns nothing for rows filtered to old pages.
const pageFilter = (page: number) => [
  { field: { id: ROWIDX }, model: { operator: "greaterThanOrEqual", value: (page - 1) * PAGE_SIZE + 1 } },
  { field: { id: ROWIDX }, model: { operator: "lessThanOrEqual", value: page * PAGE_SIZE } },
];
export const gridPageFilter = pageFilter;

const inFilter = (rowIdx: number[]) => [
  { field: { id: ROWIDX }, model: { operator: "isIn", value: rowIdx } },
];

function GridPager(params: Ctx) {
  // Filtered rows in ledger order — the same set the grid sees before its
  // own widget (rowIdx) filter, so each page's slice is the exact `isIn` set.
  const rows = useFilteredActivity(params);
  const api = params.api;
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [page, setPage] = useState(1);

  const go = (p: number, list = rows) => {
    const clamped = Math.min(Math.max(1, p), Math.max(1, Math.ceil(list.length / PAGE_SIZE)));
    setPage(clamped);
    const slice = list
      .slice((clamped - 1) * PAGE_SIZE, clamped * PAGE_SIZE)
      .map((r) => r.rowIdx);
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
                  [GRID_ID]: inFilter(slice) as never,
                },
              },
            }
          : pg
      ),
    });
  };

  // The filtered set changed (status pill, Ask filter, new data): land back
  // on page 1 of the new set instead of pointing at stale rank values.
  const rowsSig = rows.map((r) => r.ref).join(",");
  useEffect(() => {
    go(1, rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSig]);

  const lo = (page - 1) * PAGE_SIZE + 1;
  const hi = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="grid-pager">
      <span className="grid-pager-info">
        {total === 0 ? "No items" : `${lo}–${hi} of ${total} items · ${PAGE_SIZE} per page`}
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
