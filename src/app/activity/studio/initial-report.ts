// The built-in "Activity" report as a bento layout (see the reference board):
// hero area chart left, Fun money + Recent activity stacked right, a KPI tile
// row, Spend by day + Requests by status, then the purchase requests grid
// full width. Charts and cards are custom widgets (./bento-widgets.tsx) that
// read rows through Studio `context`; only the grid is a Studio widget.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import {
  W_FUN_MONEY,
  W_KPI_ROW,
  W_RECENT,
  W_SPEND_DAY,
  W_SPEND_TREND,
  W_STATUS_BARS,
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
  [W_KPI_ROW]: {
    type: W_KPI_ROW as never,
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
        // scroll on desktop widths; the grand total row is relabelled in
        // ./cell-renderers.tsx so it can't read as budget spend.
        columnAutoSize: true,
        grandTotalRow: { enabled: true },
      },
    },
  },
};

// 12-track canvas: hero chart 8 wide, the Fun money / Recent column 4 wide,
// KPI band full width, two half-width charts, then the grid.
const activity: AgPageState = {
  id: "activity",
  layout: { columns: 12 },
  widgets: activityWidgets,
  widgetLayout: {
    [W_SPEND_TREND]: at(0, 0, 8, 24),
    [W_FUN_MONEY]: at(8, 0, 4, 15),
    [W_RECENT]: at(8, 15, 4, 9),
    [W_KPI_ROW]: at(0, 24, 12, 6),
    [W_SPEND_DAY]: at(0, 30, 6, 15),
    [W_STATUS_BARS]: at(6, 30, 6, 15),
    "requests-grid": at(0, 45, 12, 20),
  },
};

// Under 1100px the same widgets reflow onto a 6-track canvas: the hero chart
// full width, Fun money and Recent side by side, then stacked charts.
const activityCompact: AgPageState = {
  ...activity,
  layout: { columns: 6, minWidth: 280, rowHeight: 16 },
  widgetLayout: {
    [W_SPEND_TREND]: at(0, 0, 6, 18),
    [W_FUN_MONEY]: at(0, 18, 3, 17),
    [W_RECENT]: at(3, 18, 3, 17),
    [W_KPI_ROW]: at(0, 35, 6, 8),
    [W_SPEND_DAY]: at(0, 43, 6, 14),
    [W_STATUS_BARS]: at(0, 57, 6, 13),
    "requests-grid": at(0, 70, 6, 26),
  },
};

// Under 720px everything stacks in one column; the KPI row renders 2×2 inside.
const activityMobile: AgPageState = {
  ...activityCompact,
  widgetLayout: {
    [W_SPEND_TREND]: at(0, 0, 6, 26),
    [W_FUN_MONEY]: at(0, 26, 6, 16),
    [W_RECENT]: at(0, 42, 6, 15),
    [W_KPI_ROW]: at(0, 57, 6, 9),
    [W_SPEND_DAY]: at(0, 66, 6, 14),
    [W_STATUS_BARS]: at(0, 80, 6, 13),
    "requests-grid": at(0, 93, 6, 26),
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
