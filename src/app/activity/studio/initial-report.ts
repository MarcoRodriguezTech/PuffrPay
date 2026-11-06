// The built-in "Activity" report: KPI tiles on top, then the hero chart next
// to the Fun money card, three equal cards (Recent activity / Spend by day /
// Requests by status), the paginated purchase grid full width, and the pager
// strip under it. Charts and cards are custom widgets (./bento-widgets.tsx)
// that read rows through Studio `context`; only the grid is a Studio widget.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import {
  W_FUN_RECENT,
  W_GRID_PAGER,
  W_KPI_ROW,
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
  [W_FUN_RECENT]: {
    type: W_FUN_RECENT as never,
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
    [W_KPI_ROW]: at(0, 0, 12, 7),
    [W_SPEND_TREND]: at(0, 7, 8, 22),
    // Tall right column: Fun money on top, Recent activity below — one card.
    [W_FUN_RECENT]: at(8, 7, 4, 46),
    // Spend by day takes Recent's old slot; Requests by status takes Spend's.
    [W_SPEND_DAY]: at(0, 29, 4, 24),
    [W_STATUS_BARS]: at(4, 29, 4, 24),
    "requests-grid": at(0, 53, 12, 26),
    [W_GRID_PAGER]: at(0, 79, 12, 4),
  },
};

// Under 1100px: a 6-track canvas (~two columns), 16px rows.
const activityCompact: AgPageState = {
  ...activity,
  layout: { columns: 6, minWidth: 280, rowHeight: 16 },
  widgetLayout: {
    [W_KPI_ROW]: at(0, 0, 6, 8),
    [W_SPEND_TREND]: at(0, 8, 6, 16),
    [W_FUN_RECENT]: at(0, 24, 6, 52),
    [W_SPEND_DAY]: at(0, 76, 3, 27),
    [W_STATUS_BARS]: at(3, 76, 3, 27),
    "requests-grid": at(0, 103, 6, 29),
    [W_GRID_PAGER]: at(0, 132, 6, 4),
  },
};

// Under 720px everything stacks in one column; the KPI row renders 2×2 inside.
const activityMobile: AgPageState = {
  ...activityCompact,
  widgetLayout: {
    [W_KPI_ROW]: at(0, 0, 6, 15),
    [W_SPEND_TREND]: at(0, 15, 6, 16),
    [W_FUN_RECENT]: at(0, 31, 6, 52),
    [W_SPEND_DAY]: at(0, 83, 6, 13),
    [W_STATUS_BARS]: at(0, 96, 6, 12),
    "requests-grid": at(0, 108, 6, 29),
    [W_GRID_PAGER]: at(0, 137, 6, 4),
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
