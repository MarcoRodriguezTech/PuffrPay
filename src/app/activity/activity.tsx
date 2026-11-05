"use client";

// The Activity page: a thin PuffrPay shell around a single AG Studio instance.
// Studio's configuration (data sources, theme, default report) lives in ./studio.
//
// One question box only: when a real LLM is configured (`chatMode === "studio"`)
// the Studio AI chat panel answers questions about the data; otherwise the Ask
// box above the dashboard turns a question into validated page filters. If
// Studio itself fails to load, we fall back to the classic AG Grid view at
// /audit/classic.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createAiHarness,
  enableStudioDevValidations,
  type AgReportState,
  type AgStudioApi,
  type AgStudioMode,
  type AgWidgetsConfig,
  type AgAiHarnessSetupParams,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { DashboardData } from "@/lib/dashboard-data";
import { isRateLimitMsg } from "@/lib/ui";
import {
  filterLabel,
  type AuditFilter,
  type AuditQuerySpec,
} from "@/lib/audit-filters";
import { buildStudioData, hasData } from "./studio/data";
import { puffrStudioTheme } from "./studio/theme";
import {
  DEFAULT_PAGE_TITLES,
  initialCompactReport,
  initialMobileReport,
  initialReport,
} from "./studio/initial-report";
import { pufferWidgetDef } from "./studio/puffer-widget";
import { createCellRenderer } from "./studio/cell-renderers";
import { specToGridSort, specToStudioFilters, specSummary } from "./studio/ask";
import { studioChatAdapter } from "./studio/ai-adapter";
import * as reportState from "./report-state";

if (process.env.NODE_ENV !== "production") {
  enableStudioDevValidations();
}

const STORAGE_KEY = "puffrpay:studio-report:v2";
const STORAGE_KEY_COMPACT = `${STORAGE_KEY}:compact`;
const STORAGE_KEY_MOBILE = `${STORAGE_KEY}:mobile`;

// The Studio canvas swaps layouts with the viewport: stacked 6-column compact
// under 1100px, single-column mobile under 720px.
const COMPACT_QUERY = "(max-width: 1099px)";
const MOBILE_QUERY = "(max-width: 719px)";

// Toolbar selects write page filters on these Studio fields.
const PERIOD_FILTERS: Record<string, AuditFilter[]> = {
  all: [],
  week: [{ field: "created_at", operator: "gte", value: "week" }],
  month: [{ field: "created_at", operator: "gte", value: "month" }],
};

const STATUS_FILTERS: Record<string, AuditFilter[]> = {
  all: [],
  PURCHASED: [{ field: "status", operator: "eq", value: "PURCHASED" }],
  WAITING: [{ field: "status", operator: "eq", value: "WAITING" }],
  BLOCKED: [{ field: "status", operator: "eq", value: "BLOCKED" }],
  REJECTED: [{ field: "status", operator: "eq", value: "REJECTED" }],
};

const ASK_CHIPS = [
  "blocked this week",
  "total spent this month",
  "waiting for approval",
];

const PROMPT_STARTERS = [
  { label: "What got blocked this week?", prompt: "Which purchase requests were blocked this week, and why?" },
  { label: "How much did Puffr spend?", prompt: "How much has the agent spent this month against the cap?" },
  { label: "Summarise the requests", prompt: "Summarise recent purchase requests and their statuses." },
];

type SavedDashboard = {
  state: AgReportState;
  pageTitles: Record<string, string>;
};

function loadSaved(key: string): SavedDashboard | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedDashboard;
    return saved.state?.pages?.length ? saved : null;
  } catch {
    return null;
  }
}

const noSubscription = () => () => {};

export function Activity({
  data,
  licenseKey,
  chatMode,
}: {
  data: DashboardData;
  licenseKey?: string;
  chatMode: "studio" | "ask";
}) {
  // Saved reports live in localStorage, which only exists in the browser.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );
  return (
    <main className="page studio-page">
      {inBrowser ? (
        <StudioDashboard data={data} licenseKey={licenseKey} chatMode={chatMode} />
      ) : (
        <div className="studio-card studio-skeleton" />
      )}
    </main>
  );
}

function StudioDashboard({
  data,
  licenseKey,
  chatMode,
}: {
  data: DashboardData;
  licenseKey?: string;
  chatMode: "studio" | "ask";
}) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [failed, setFailed] = useState(false);

  // Studio failing to load = automatic fallback to the classic grid.
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => window.location.assign("/audit/classic"), 900);
    return () => clearTimeout(t);
  }, [failed]);

  // The report variant is decided once at mount — this component only renders
  // in the browser (SSR returns the skeleton).
  const [variant] = useState(() =>
    window.matchMedia(MOBILE_QUERY).matches
      ? "mobile"
      : window.matchMedia(COMPACT_QUERY).matches
        ? "compact"
        : "desktop"
  );
  const storageKey =
    variant === "mobile"
      ? STORAGE_KEY_MOBILE
      : variant === "compact"
        ? STORAGE_KEY_COMPACT
        : STORAGE_KEY;
  const baseReport =
    variant === "mobile"
      ? initialMobileReport
      : variant === "compact"
        ? initialCompactReport
        : initialReport;

  // The last-saved dashboard: null means the built-in report is in use.
  const [saved, setSaved] = useState<SavedDashboard | null>(() =>
    loadSaved(storageKey)
  );
  const [pageTitles] = useState<Record<string, string>>(
    () => saved?.pageTitles ?? DEFAULT_PAGE_TITLES
  );

  // Studio reads initialState once, when it is created. The filters panel
  // starts collapsed — the Ask box does page filtering, and an expanded panel
  // would cover the right edge of the report.
  const [initialState] = useState(() => {
    const st = reportState.withFiltersPanelFor(
      "view",
      saved?.state ?? baseReport
    );
    return {
      ...st,
      panels: {
        ...st.panels,
        filters: { ...st.panels?.filters, collapsed: true },
      },
    };
  });
  const [studioState, setStudioState] = useState<AgReportState | null>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");

  const state = studioState ?? initialState;
  const studioData = useMemo(() => buildStudioData(data), [data]);

  // Studio gets the raw rows through `context` for the custom Puffer widget.
  const context = useMemo(() => ({ data }), [data]);

  // Register the PufferGauge widget and the grid's custom cell renderers.
  const widgets = useMemo(
    () => (defaults: AgWidgetsConfig) =>
      ({
        ...defaults,
        widgets: [
          ...defaults.widgets.map((d) =>
            d.id === "grid"
              ? { ...d, options: { ...(d as { options?: object }).options, createCellRenderer } }
              : d
          ),
          pufferWidgetDef,
        ],
      }) as never,
    []
  );

  const ai = useMemo(
    () =>
      chatMode === "studio"
        ? ({ api }: AgAiHarnessSetupParams) =>
            createAiHarness(api, {
              adapter: studioChatAdapter,
              primary: "lead",
              promptStarters: PROMPT_STARTERS,
            })
        : undefined,
    [chatMode]
  );

  const baseline = saved?.state ?? baseReport;
  const dirty = reportState.hasChanges(state, baseline);

  const save = () => {
    const api = apiRef.current;
    if (!api) return;
    const next: SavedDashboard = { state: api.getState(), pageTitles };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage full or blocked: keep working in memory for this session.
    }
    setSaved(next);
  };

  const reset = () => {
    const api = apiRef.current;
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    setSaved(null);
    if (api) {
      api.setState(reportState.withFiltersPanelFor("view", baseReport));
      api.clearHistory();
      setStudioState(api.getState());
      setMode("view");
    }
  };

  const editing = mode === "edit";

  // --- Ask box + filter toolbar --------------------------------------------
  //
  // The Ask box (when Studio chat is off) and the Period/Status selects both
  // write Studio page filters; the two sets are merged before applying so
  // chips and selects stay independent.

  const [question, setQuestion] = useState("");
  const [askFilters, setAskFilters] = useState<AuditFilter[]>([]);
  const [askError, setAskError] = useState<string | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const askCache = useRef(new Map<string, AuditQuerySpec>());

  const [period, setPeriod] = useState("all");
  const [statusSel, setStatusSel] = useState("all");
  const toolFilters = useMemo(
    () => [...(PERIOD_FILTERS[period] ?? []), ...(STATUS_FILTERS[statusSel] ?? [])],
    [period, statusSel]
  );

  const applyPageFilters = (ask: AuditFilter[], tool: AuditFilter[]) => {
    const api = apiRef.current;
    const st = api?.getState();
    if (!api || !st) return;
    api.setState({
      ...st,
      pages: st.pages.map((p) =>
        p.id === st.selectedPageId
          ? {
              ...p,
              filter: { ...p.filter, page: specToStudioFilters([...ask, ...tool]) },
            }
          : p
      ),
    });
  };

  // Re-apply whenever the toolbar selects change.
  useEffect(() => {
    applyPageFilters(askFilters, toolFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolFilters]);

  const applySpec = (spec: AuditQuerySpec) => {
    const api = apiRef.current;
    const st = api?.getState();
    if (!api || !st) return;
    const pages = st.pages.map((p) => {
      if (p.id !== st.selectedPageId) return p;
      const next = {
        ...p,
        filter: {
          ...p.filter,
          page: specToStudioFilters([...spec.filters, ...toolFilters]),
        },
      };
      const gridSort = specToGridSort(spec.sort);
      if (gridSort && next.widgets?.["requests-grid"]) {
        next.widgets = {
          ...next.widgets,
          "requests-grid": { ...next.widgets["requests-grid"], sort: gridSort },
        };
      }
      return next;
    });
    api.setState({ ...st, pages });
  };

  const summary = useMemo(() => {
    if (askFilters.length === 0) return null;
    const spec: AuditQuerySpec = {
      filters: askFilters,
      sort: null,
      summary: { type: "sum" },
      understood: "",
    };
    return specSummary(spec, data.requests);
  }, [askFilters, data.requests]);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || askBusy) return;
    setAskBusy(true);
    setAskError(null);
    const key = text.toLowerCase();
    const cached = askCache.current.get(key);
    if (cached) {
      setAskFilters(cached.filters);
      applySpec(cached);
      setAskBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/audit/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const spec = (await res.json()) as AuditQuerySpec & { error?: string };
      if (!res.ok) {
        setAskError(
          res.status === 422
            ? "I could not turn that into a filter. Try: show blocked purchases this week."
            : isRateLimitMsg(String(spec.error ?? ""))
              ? "Puffr is catching its breath. Try again in a minute."
              : "Something went wrong on our side. Try again."
        );
        if (res.status !== 422) console.error("[ask] query failed:", spec.error);
        return;
      }
      askCache.current.set(key, spec);
      setAskFilters(spec.filters);
      applySpec(spec);
    } catch (err) {
      console.error("[ask] query failed:", err);
      setAskError("Something went wrong on our side. Try again.");
    } finally {
      setAskBusy(false);
    }
  }

  const removeFilter = (idx: number) => {
    const next = askFilters.filter((_, i) => i !== idx);
    setAskFilters(next);
    applyPageFilters(next, toolFilters);
  };

  const clearAsk = () => {
    setQuestion("");
    setAskFilters([]);
    setAskError(null);
    applyPageFilters([], toolFilters);
  };

  // The Studio filters panel opens as an overlay drawer from the toolbar.
  const filtersPanelOpen = !(state.panels?.filters?.collapsed ?? true);
  const toggleFiltersPanel = () => {
    const api = apiRef.current;
    const st = api?.getState();
    if (!api || !st) return;
    api.setState({
      ...st,
      panels: {
        ...st.panels,
        filters: { ...st.panels?.filters, collapsed: filtersPanelOpen },
      },
    });
  };

  // --- render ----------------------------------------------------------------

  if (failed) {
    return (
      <main className="page">
        <h1>Activity</h1>
        <p className="notice">
          The report view didn&apos;t load — taking you to the{" "}
          <a href="/audit/classic">classic log</a>.
        </p>
      </main>
    );
  }

  return (
    <>
      <div className="row spread studio-toolbar">
        <div>
          <h1>Activity</h1>
          <p className="muted studio-sub">
            Everything Puffr did with your fun money.
          </p>
        </div>
        <div className="row">
          <a className="chip" href="/audit/classic">
            Classic log
          </a>
          <button
            className="secondary"
            onClick={() => setMode(editing ? "view" : "edit")}
          >
            {editing ? "Done" : "Edit report"}
          </button>
          <button className="secondary" onClick={save} disabled={!dirty}>
            {dirty ? "Save" : "Saved"}
          </button>
          <button
            className="secondary danger"
            onClick={reset}
            disabled={!saved && !dirty}
          >
            Reset
          </button>
        </div>
      </div>

      {chatMode === "ask" && (
        <div className="ask-box">
          <label htmlFor="ask-q">Ask the log</label>
          <form
            className="ask-row"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input
              id="ask-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. show everything the agent blocked this week"
              disabled={askBusy}
            />
            <button type="submit" disabled={askBusy || !question.trim()}>
              {askBusy ? "Thinking..." : "Ask"}
            </button>
            {(askFilters.length > 0 || question) && (
              <button type="button" className="secondary" onClick={clearAsk}>
                Clear
              </button>
            )}
          </form>
          <div className="ask-chips">
            {ASK_CHIPS.map((c) => (
              <button
                key={c}
                className="chip"
                onClick={() => {
                  setQuestion(c);
                  ask(c);
                }}
              >
                {c}
              </button>
            ))}
          </div>
          {askFilters.length > 0 && (
            <div className="applied">
              <span className="lbl">Applied:</span>
              {askFilters.map((f, i) => (
                <span className="filter-chip" key={i}>
                  {filterLabel(f)}
                  <button
                    aria-label={`Remove filter ${filterLabel(f)}`}
                    onClick={() => removeFilter(i)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {summary && <div className="audit-summary">{summary.text}</div>}
          {askError && (
            <div className="error" style={{ marginTop: 12 }}>
              {askError}
            </div>
          )}
        </div>
      )}

      <div className="studio-filters-bar">
        <label className="sel">
          <span>Period</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            aria-label="Filter by period"
          >
            <option value="all">All time</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
        </label>
        <label className="sel">
          <span>Status</span>
          <select
            value={statusSel}
            onChange={(e) => setStatusSel(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="PURCHASED">Bought</option>
            <option value="WAITING">Waiting for you</option>
            <option value="BLOCKED">Blocked</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <button
          className={`secondary filters-btn${filtersPanelOpen ? " chip-active" : ""}`}
          onClick={toggleFiltersPanel}
          aria-pressed={filtersPanelOpen}
        >
          Filters
        </button>
      </div>

      <div className="studio-card">
        {hasData(data) ? (
          <AgStudioProvider licenseKey={licenseKey}>
            <AgStudio
              style={{ height: "auto", width: "100%" }}
              theme={puffrStudioTheme}
              layout={{ widgetBorderEnabled: true }}
              data={studioData}
              context={context}
              widgets={widgets}
              ai={ai}
              initialState={initialState}
              mode={mode}
              onApiReady={(event) => {
                apiRef.current = event.api;
              }}
              onStudioReady={(event) => {
                setStudioState(event.api.getState());
              }}
              onStateUpdated={(event) => {
                setStudioState(event.state);
              }}
              onErrorRaised={(event) => {
                console.error("[studio] runtime error:", event);
                setFailed(true);
              }}
            />
          </AgStudioProvider>
        ) : (
          <p className="empty-note">
            Nothing yet. Ask Puffr to buy something on the Agent screen.
          </p>
        )}
      </div>

      <footer className="activity-footer">
        <pre className="ascii" aria-hidden="true">{`  ><(((°>  ~ ~`}</pre>
        <p className="muted">Puffr never spends without the rules.</p>
      </footer>
    </>
  );
}
