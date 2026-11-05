// The built-in "Activity" report: one page with the pufferfish gauge, KPI
// tiles, status charts and the purchase requests grid, as AG Studio report
// state. Field ids ('requests.spent') refer to the data sources in ./data.ts.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import { PUFFER_WIDGET_TYPE } from "./puffer-widget";

// --- Helpers ----------------------------------------------------------------------

// Position on the canvas grid, in tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });

const SANS = 'var(--font-plex-sans), system-ui, sans-serif';
const MONO = 'var(--font-plex-mono), ui-monospace, monospace';

const typography = (
  fontSize: number,
  fontWeight: "normal" | "bold" = "normal",
  fontFamily: string = SANS
) => ({
  fontFamily,
  fontSize,
  fontWeight,
  fontStyle: "normal" as const,
});

// A KPI tile: mono-caps label, large mono value, optional sparkline along `sparklineX`.
const kpi = (
  text: string,
  value: { id: string; aggregation?: "sum" | "avg" | "countd" },
  opts: { sparklineX?: string; gold?: boolean; fontSize?: number } = {}
) => ({
  type: "value" as const,
  dataMapping: {
    value: [value],
    ...(opts.sparklineX && { sparklineX: [{ id: opts.sparklineX }] }),
  },
  format: {
    title: { enabled: true, text, typography: typography(12, "bold", MONO) },
    caption: { enabled: true, text: "", typography: typography(0) },
    style: { typography: typography(opts.fontSize ?? 28, "bold", MONO) },
    ...(opts.gold && { widget: { backgroundColor: "var(--gold-soft)" } }),
  },
});

// --- Page --------------------------------------------------------------------------

// Widget definitions are shared by the desktop and stacked mobile layouts.
const activityWidgets: AgPageState["widgets"] = {
    // Custom widget registered in ./puffer-widget.tsx — reads budget via context.
    "puffer-gauge": {
      type: PUFFER_WIDGET_TYPE as never,
      dataMapping: {},
      format: title("Fun money"),
    },
    "kpi-kept": kpi("KEPT BY THE LEASH", sum("requests.blocked"), { gold: true }),
    "kpi-spent": kpi("SPENT", sum("requests.spent"), { sparklineX: "calendar::month" }),
    "kpi-requests": kpi("REQUESTS", countd("requests.ref")),
    "kpi-waiting": kpi("WAITING ON YOU", sum("requests.waiting")),
    // Running spend against the monthly cap. Series order is palette order:
    // cap lands on danger (the line you must not cross), spend on ok.
    "spend-vs-cap": {
      type: "line-chart",
      dataMapping: {
        categoryKey: [{ id: "requests.createdAt" }],
        valueKey: [
          { id: "requests.monthlyCap", aggregation: "max" },
          { id: "requests.cumulative", aggregation: "max" },
        ],
      },
      format: {
        ...title("Cumulative spend vs cap"),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    // Status goes on the legend (alphabetical => shared palette lands
    // semantically: BLOCKED=danger, PURCHASED=ok, REJECTED=ink-soft,
    // WAITING=gold). Donut/pie charts order slices by data appearance, so they
    // can't hold these colors.
    "decisions-chart": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "requests.decision" }],
        valueKey: [countd("requests.ref")],
        legendKey: [{ id: "requests.status" }],
      },
      format: {
        ...title("Requests by policy decision"),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    "category-spend": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "requests.category" }],
        valueKey: [sum("requests.amount")],
        legendKey: [{ id: "requests.status" }],
      },
      format: {
        ...title("Requested spend by category and status"),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    "requests-grid": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "requests.createdAt" },
          { id: "requests.title" },
          { id: "requests.category" },
          sum("requests.amount"),
          { id: "requests.status" },
          { id: "requests.decidedBy" },
          { id: "requests.reason" },
        ],
      },
      sort: [{ field: { id: "requests.createdAt" }, direction: "desc" }],
      format: {
        ...title("All purchase requests"),
        style: {
          // Columns size to content so every column fits without a sideways
          // scroll on desktop widths; the grand total row is relabelled in
          // ./cell-renderers.tsx so it can't read as budget spend.
          columnAutoSize: true,
          grandTotalRow: { enabled: true },
        },
      },
    },
};

// 12-track canvas: KPI row, then gauge (3 wide, ~270px tall) beside the
// cumulative spend chart (9), decisions (4) next to category spend (8),
// and the grid full width underneath.
const activity: AgPageState = {
  id: "activity",
  layout: { columns: 12 },
  widgets: activityWidgets,
  widgetLayout: {
    "kpi-kept": at(0, 0, 3, 7),
    "kpi-spent": at(3, 0, 3, 7),
    "kpi-requests": at(6, 0, 3, 7),
    "kpi-waiting": at(9, 0, 3, 7),
    "puffer-gauge": at(0, 7, 3, 15),
    "spend-vs-cap": at(3, 7, 9, 15),
    "decisions-chart": at(0, 22, 4, 14),
    "category-spend": at(4, 22, 8, 14),
    "requests-grid": at(0, 36, 12, 20),
  },
};

// Under 1100px the same widgets reflow onto a 6-track canvas: gauge and
// charts full width, KPI tiles two per row. minWidth below a phone viewport
// so the canvas fits; the grid keeps its own horizontal scroll inside.
const activityCompact: AgPageState = {
  ...activity,
  layout: { columns: 6, minWidth: 280, rowHeight: 16 },
  widgetLayout: {
    "kpi-kept": at(0, 0, 3, 7),
    "kpi-spent": at(3, 0, 3, 7),
    "kpi-requests": at(0, 7, 3, 7),
    "kpi-waiting": at(3, 7, 3, 7),
    "puffer-gauge": at(0, 14, 6, 18),
    "spend-vs-cap": at(0, 32, 6, 14),
    "decisions-chart": at(0, 46, 6, 14),
    "category-spend": at(0, 60, 6, 14),
    "requests-grid": at(0, 74, 6, 26),
  },
};

// Under 720px everything stacks in one column. Same widgets, but KPI tiles go
// full width so the numbers never truncate inside a narrow tile.
const activityMobile: AgPageState = {
  ...activityCompact,
  widgets: {
    ...activityWidgets,
    "kpi-kept": kpi("KEPT BY THE LEASH", sum("requests.blocked"), { gold: true, fontSize: 24 }),
    "kpi-spent": kpi("SPENT", sum("requests.spent"), { sparklineX: "calendar::month", fontSize: 24 }),
    "kpi-requests": kpi("REQUESTS", countd("requests.ref"), { fontSize: 24 }),
    "kpi-waiting": kpi("WAITING ON YOU", sum("requests.waiting"), { fontSize: 24 }),
  },
  widgetLayout: {
    "kpi-kept": at(0, 0, 6, 7),
    "kpi-spent": at(0, 7, 6, 7),
    "kpi-requests": at(0, 14, 6, 7),
    "kpi-waiting": at(0, 21, 6, 7),
    "puffer-gauge": at(0, 28, 6, 18),
    "spend-vs-cap": at(0, 46, 6, 14),
    "decisions-chart": at(0, 60, 6, 14),
    "category-spend": at(0, 74, 6, 14),
    "requests-grid": at(0, 88, 6, 26),
  },
};

// Page titles live outside Studio state (it has no page names), keyed by page id.
export const DEFAULT_PAGE_TITLES: Record<string, string> = {
  activity: "Activity",
};

// The report has a single page; Studio still needs the array + selection.
export const initialReport: AgReportState = {
  selectedPageId: activity.id,
  pages: [activity],
};

export const initialCompactReport: AgReportState = {
  selectedPageId: activityCompact.id,
  pages: [activityCompact],
};

export const initialMobileReport: AgReportState = {
  selectedPageId: activityMobile.id,
  pages: [activityMobile],
};
