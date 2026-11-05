// Pure helpers over AG Studio's report state (AgReportState), trimmed from the
// boilerplate's report-state.ts to what this simpler shell uses.

import type { AgReportState, AgStudioMode } from "ag-studio";

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

// The filters panel starts expanded in view mode, where it's the only panel,
// and collapsed in edit mode, where Compose and Data need the room.
export const withFiltersPanelFor = (mode: AgStudioMode, state: AgReportState): AgReportState => ({
  ...state,
  panels: { ...state.panels, filters: { ...state.panels?.filters, collapsed: mode === "edit" } },
});

// Studio leaves page navigation to the host.
export const selectPage = (state: AgReportState, pageId: string): AgReportState => ({
  ...state,
  selectedPageId: pageId,
});
