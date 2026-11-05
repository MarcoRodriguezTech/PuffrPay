"use client";

// The custom Studio widget that puts the living PufferGauge on the report
// canvas. It needs no data mapping — the budget ratio arrives through Studio's
// `context` property, which the page sets to the DashboardData.

import type { AgWidgetDefinition } from "ag-studio-react";
import type { AgWidgetData, AgWidgetDataFormat, AgWidgetParams } from "ag-studio";
import type { DashboardData } from "@/lib/dashboard-data";
import { PufferGauge, STATE_LABELS, stateForRatio } from "@/components/PufferGauge";
import { fmtWhole } from "@/lib/ui";

export const PUFFER_WIDGET_TYPE = "puffer-gauge";

type PufferWidgetData = AgWidgetData<Record<string, never>, AgWidgetDataFormat<unknown>>;

export function PufferWidget(params: AgWidgetParams<PufferWidgetData>) {
  const data = (params.context as { data?: DashboardData })?.data;
  const cap = data?.requests[0]?.monthlyCap ?? data?.policy[0]?.monthlyCap ?? 0;
  const spent = (data?.requests ?? []).reduce((s, r) => s + (r.spent ?? 0), 0);
  const ratio = cap > 0 ? spent / cap : 0;
  const state = stateForRatio(ratio);
  const pct = Math.min(100, Math.round(ratio * 100));

  return (
    <div className="puffer-widget">
      <PufferGauge ratio={ratio} size={140} />
      <div className="puffer-widget-amount mono">
        {fmtWhole(Math.round(spent * 100))} of {fmtWhole(Math.round(cap * 100))}
      </div>
      <div className="puffer-widget-state mono muted">
        {pct}% — {STATE_LABELS[state]}
      </div>
    </div>
  );
}

// Registered through the AgStudio `widgets` prop (see activity.tsx).
export const pufferWidgetDef: AgWidgetDefinition<string, PufferWidgetData> = {
  id: PUFFER_WIDGET_TYPE,
  label: "Puffr gauge",
  icon: { url: "/mascot/puffr-placeholder.svg" },
  comp: PufferWidget,
  form: ({ createDefaults }) => createDefaults({ dataMappingItems: [] }),
  defaultSize: { width: 220, height: 380 },
  minSize: { width: 160, height: 260 },
  ai: {
    label: "Puffr gauge",
    description:
      "The pufferfish mascot showing how much of the monthly fun money cap is spent. " +
      "It swells as the budget fills.",
  },
};
