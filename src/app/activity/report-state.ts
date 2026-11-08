// Pure helpers over AG Studio's report state (AgReportState), trimmed from the
// boilerplate's report-state.ts to what this simpler shell uses.

import type { AgReportState } from "ag-studio";

// Whether `state` differs from `saved` in anything worth saving. The selected
// page, cross-filters, selection and panel sizes also live in state, but
// changing them doesn't make a report unsaved.
export const hasChanges = (state: AgReportState, saved: AgReportState) =>
  durable(state) !== durable(saved);

const durable = (state: AgReportState) =>
  JSON.stringify({
    schema: state.schema,
    pages: state.pages.map(({ id, widgets, widgetLayout, layout, filter }) => ({
      id,
      widgets,
      widgetLayout,
      layout,
      filter,
    })),
  });

// The filters panel only exists in edit mode; keep its state entry
// collapsed either way so a persisted "expanded" flag can't leak in.
export const withCollapsedFilters = (state: AgReportState): AgReportState => ({
  ...state,
  panels: { ...state.panels, filters: { ...state.panels?.filters, collapsed: true } },
});

// Studio leaves page navigation to the host.
export const selectPage = (state: AgReportState, pageId: string): AgReportState => ({
  ...state,
  selectedPageId: pageId,
});
