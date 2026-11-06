// The built-in "Activity" report: KPI tiles on top, then the hero chart next
// to the Fun money card, three equal cards (Recent activity / Spend by day /
// Requests by status), the paginated purchase grid full width, and the pager
// strip under it. Charts and cards are custom widgets (./bento-widgets.tsx)
// that read rows through Studio `context`; only the grid is a Studio widget.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import {
  W_FUN_MONEY,
  W_GRID_PAGER,
  W_KPI_ROW,
  W_RECENT,
  W_SPEND_DAY,
  W_SPEND_TREND,
  W_STATUS_BARS,
  gridPageFilter,
} from "./bento-widgets";

// --- Helpers ------------------------------------------------------------------

// Position on the canvas grid, in tracks: N columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
// Custom widgets draw their own in-card headers — no Studio title chrome.
const noChrome = { title: { enabled: false } };
const sum = (id: string) => ({ id, aggregation: "sum" as const });

// --- Widgets -------------------------------------------------------------------

const activityWidgets: AgPageState["widgets"] = {
  [W_KPI_ROW]: {
    type: W_KPI_ROW as never,
    dataMapping: {},
    format: noChrome,
  },
  [W_SPEND_TREND]: {
    type: W_SPEND_TREND as never,
    dataMapping: {},
    format: noChrome,
  },
  [W_FUN_MONEY]: {
    type: W_FUN_MONEY as never,
    dataMapping: {},
    format: noChrome,
  },
  [W_RECENT]: {
    type: W_RECENT as never,
    dataMapping: {},
    format: noChrome,
  },
  [W_SPEND_DAY]: {
    type: W_SPEND_DAY as never,
    dataMapping: {},
    format: noChrome,
  },
  [W_STATUS_BARS]: {
    type: W_STATUS_BARS as never,
    dataMapping: {},
    format: noChrome,
  },
  "requests-grid": {
    type: "grid",
    dataMapping: {
      cols: [
        { id: "requests.createdAt" },
        { id: "requests.title" },
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
        // scroll on desktop widths; the pinned footer row is relabelled in
        // ./cell-renderers.tsx so it can't read as budget spend.
        columnAutoSize: true,
        grandTotalRow: { enabled: true },
      },
    },
  },
  [W_GRID_PAGER]: {
    type: W_GRID_PAGER as never,
    dataMapping: {},
    format: noChrome,
  },
};

// The grid pages by a widget filter on the hidden rowIdx field — page 1 is
// requests 1-8 newest-first, set here so a fresh report starts paged.
const gridFilter = {
  page: [],
  widget: { "requests-grid": gridPageFilter(1) as never },
};

// 12-track canvas, 18px rows: KPI band -> chart + fun money -> three equal
// cards -> grid -> pager.
const activity: AgPageState = {
  id: "activity",
  layout: { columns: 12 },
  widgets: activityWidgets,
  filter: gridFilter,
  widgetLayout: {
    [W_KPI_ROW]: at(0, 0, 12, 9),
    [W_SPEND_TREND]: at(0, 9, 8, 26),
    [W_FUN_MONEY]: at(8, 9, 4, 26),
    [W_RECENT]: at(0, 35, 4, 34),
    [W_SPEND_DAY]: at(4, 35, 4, 34),
    [W_STATUS_BARS]: at(8, 35, 4, 34),
    "requests-grid": at(0, 69, 12, 33),
    [W_GRID_PAGER]: at(0, 102, 12, 4),
  },
};

// Under 1100px: a 6-track canvas (~two columns), 16px rows.
const activityCompact: AgPageState = {
  ...activity,
  layout: { columns: 6, minWidth: 280, rowHeight: 16 },
  widgetLayout: {
    [W_KPI_ROW]: at(0, 0, 6, 10),
    [W_SPEND_TREND]: at(0, 10, 6, 18),
    [W_FUN_MONEY]: at(0, 28, 6, 27),
    [W_RECENT]: at(0, 55, 3, 38),
    [W_SPEND_DAY]: at(3, 55, 3, 38),
    [W_STATUS_BARS]: at(0, 93, 6, 15),
    "requests-grid": at(0, 108, 6, 38),
    [W_GRID_PAGER]: at(0, 146, 6, 4),
  },
};

// Under 720px everything stacks in one column; the KPI row renders 2×2 inside.
const activityMobile: AgPageState = {
  ...activityCompact,
  widgetLayout: {
    [W_KPI_ROW]: at(0, 0, 6, 19),
    [W_SPEND_TREND]: at(0, 19, 6, 20),
    [W_FUN_MONEY]: at(0, 39, 6, 28),
    [W_RECENT]: at(0, 67, 6, 38),
    [W_SPEND_DAY]: at(0, 105, 6, 16),
    [W_STATUS_BARS]: at(0, 121, 6, 15),
    "requests-grid": at(0, 136, 6, 38),
    [W_GRID_PAGER]: at(0, 174, 6, 4),
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
