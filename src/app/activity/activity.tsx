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
import Image from "next/image";
import { createPortal } from "react-dom";
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
import { studioThemeFor } from "./studio/theme";
import { useTheme } from "@/lib/theme";
import { ASSETS } from "@/lib/assets";
import {
  DEFAULT_PAGE_TITLES,
  initialCompactReport,
  initialMobileReport,
  initialReport,
} from "./studio/initial-report";
import { bentoWidgetDefs } from "./studio/bento-widgets";
import { createCellRenderer, DashRowsContext } from "./studio/cell-renderers";
import { specToGridSort, specToStudioFilters, specSummary } from "./studio/ask";
import { studioChatAdapter } from "./studio/ai-adapter";
import * as reportState from "./report-state";

if (process.env.NODE_ENV !== "production") {
  enableStudioDevValidations();
}

const STORAGE_KEY = "puffrpay:studio-report:v4";
const STORAGE_KEY_COMPACT = `${STORAGE_KEY}:compact`;
const STORAGE_KEY_MOBILE = `${STORAGE_KEY}:mobile`;

// The Studio canvas swaps layouts with the viewport: stacked 6-column compact
// under 1100px, single-column mobile under 720px.
const COMPACT_QUERY = "(max-width: 1099px)";
const MOBILE_QUERY = "(max-width: 719px)";

const ASK_CHIPS = [
  "blocked this week",
  "total spent this month",
  "waiting for approval",
];

// One entry per question asked through the Ask panel — the assistant reply is
// the filter set it applied plus the one-line summary the spec produces.
type AskTurn = {
  q: string;
  filters: AuditFilter[];
  note: string | null;
  error: string | null;
};

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
  const theme = useTheme();
  // Studio treats the theme prop as live state — a fresh object every render
  // makes it re-initialise mid-load and the grid datasource never wires up.
  const studioTheme = useMemo(() => studioThemeFor(theme), [theme]);
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

  // Register the bento widgets and the grid's custom cell renderers.
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
          ...bentoWidgetDefs,
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
  const [askOpen, setAskOpen] = useState(false);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [askBusy, setAskBusy] = useState(false);
  const askCache = useRef(new Map<string, AuditQuerySpec>());
  const askScrollRef = useRef<HTMLDivElement>(null);

  // The panel squeezes the page on desktop via a body class the CSS keys off.
  useEffect(() => {
    document.body.classList.toggle("ask-open", askOpen);
    return () => document.body.classList.remove("ask-open");
  }, [askOpen]);

  // Escape closes the panel.
  useEffect(() => {
    if (!askOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAskOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [askOpen]);

  // Keep the newest turn in view.
  useEffect(() => {
    askScrollRef.current?.scrollTo({
      top: askScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, askBusy]);

  const applyPageFilters = (ask: AuditFilter[]) => {
    const api = apiRef.current;
    const st = api?.getState();
    if (!api || !st) return;
    api.setState({
      ...st,
      pages: st.pages.map((p) =>
        p.id === st.selectedPageId
          ? {
              ...p,
              filter: { ...p.filter, page: specToStudioFilters(ask) },
            }
          : p
      ),
    });
  };

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
          page: specToStudioFilters(spec.filters),
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

  const noteFor = (filters: AuditFilter[]) =>
    specSummary(
      { filters, sort: null, summary: { type: "sum" }, understood: "" },
      data.requests
    )?.text ?? null;

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || askBusy) return;
    setAskBusy(true);
    const key = text.toLowerCase();
    const cached = askCache.current.get(key);
    if (cached) {
      setAskFilters(cached.filters);
      applySpec(cached);
      setTurns((t) => [
        ...t,
        { q: text, filters: cached.filters, note: noteFor(cached.filters), error: null },
      ]);
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
        const error =
          res.status === 422
            ? "I could not turn that into a filter. Try: show blocked purchases this week."
            : isRateLimitMsg(String(spec.error ?? ""))
              ? "Puffr is catching its breath. Try again in a minute."
              : "Something went wrong on our side. Try again.";
        if (res.status !== 422) console.error("[ask] query failed:", spec.error);
        setTurns((t) => [...t, { q: text, filters: [], note: null, error }]);
        return;
      }
      askCache.current.set(key, spec);
      setAskFilters(spec.filters);
      applySpec(spec);
      setTurns((t) => [
        ...t,
        { q: text, filters: spec.filters, note: noteFor(spec.filters), error: null },
      ]);
    } catch (err) {
      console.error("[ask] query failed:", err);
      setTurns((t) => [
        ...t,
        { q: text, filters: [], note: null, error: "Something went wrong on our side. Try again." },
      ]);
    } finally {
      setAskBusy(false);
    }
  }

  const removeFilter = (idx: number) => {
    const next = askFilters.filter((_, i) => i !== idx);
    setAskFilters(next);
    applyPageFilters(next);
  };

  const clearAsk = () => {
    setQuestion("");
    setAskFilters([]);
    setTurns([]);
    applyPageFilters([]);
  };

  // The "Customize" dropdown replaces the old one-button-per-action toolbar.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Filters/Customize mount into the TopBar's actions slot on wide
  // viewports (the .studio-filters-bar fallback below is hidden there).
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarSlot(document.getElementById("topbar-actions"));
  }, []);

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

  const filtersButton = (
    <button
      className={`secondary filters-btn${filtersPanelOpen ? " chip-active" : ""}`}
      onClick={toggleFiltersPanel}
      aria-pressed={filtersPanelOpen}
    >
      Filters
    </button>
  );
  const customizeMenu = (
    <div className="customize" ref={menuRef}>
      <button
        className="secondary customize-btn"
        onClick={() => setMenuOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        Customize
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 3.5 5 6l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {menuOpen && (
        <div className="customize-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setMode(editing ? "view" : "edit");
            }}
          >
            {editing ? "Done editing" : "Edit layout"}
          </button>
          <button
            role="menuitem"
            disabled={!dirty}
            onClick={() => {
              setMenuOpen(false);
              save();
            }}
          >
            {dirty ? "Save layout" : "Layout saved"}
          </button>
          <button
            role="menuitem"
            disabled={!saved && !dirty}
            onClick={() => {
              setMenuOpen(false);
              if (window.confirm("Reset the dashboard to the built-in layout?")) reset();
            }}
          >
            Reset layout
          </button>
          <a role="menuitem" href="/audit/classic" onClick={() => setMenuOpen(false)}>
            Classic log
          </a>
        </div>
      )}
    </div>
  );

  return (
    <>
      {topbarSlot &&
        createPortal(
          <div className="topbar-activity-controls">
            {filtersButton}
            {customizeMenu}
          </div>,
          topbarSlot
        )}

      <div className="studio-filters-bar">
        {filtersButton}
        {customizeMenu}
      </div>

      <div className="studio-card">
        {hasData(data) ? (
          <AgStudioProvider licenseKey={licenseKey}>
            <DashRowsContext.Provider value={data.requests}>
            <AgStudio
              key={theme}
              style={{ height: "auto", width: "100%" }}
              theme={studioTheme}
              layout={{ widgetBorderEnabled: true }}
              data={studioData}
              context={context}
              // Studio appends "(sum)" etc. to aggregated field names — the
              // column headers and the reference design just want the name.
              localeText={{
                aggregationSumFieldName: "${name}",
                aggregationAvgFieldName: "${name}",
                aggregationCountFieldName: "${name}",
                aggregationCountdFieldName: "${name}",
              }}
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
            </DashRowsContext.Provider>
          </AgStudioProvider>
        ) : (
          <p className="empty-note">
            Nothing yet. Ask Puffr to buy something on the Agent screen.
          </p>
        )}
      </div>

      <footer className="activity-footer">
        <p className="muted">Puffr never spends without the rules.</p>
      </footer>

      {chatMode === "ask" && !askOpen && (
        <button
          className="ask-fab"
          onClick={() => setAskOpen(true)}
          aria-label="Ask the log"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
      )}

      {chatMode === "ask" && askOpen && (
        <aside className="ask-panel" role="dialog" aria-label="Ask the log">
          <header className="ask-head">
            <h2>Ask the log</h2>
            <div className="row">
              {turns.length > 0 && (
                <button className="secondary ask-clear" onClick={clearAsk}>
                  New chat
                </button>
              )}
              <button
                className="ask-close"
                onClick={() => setAskOpen(false)}
                aria-label="Close panel"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </header>

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

          <div className="ask-scroll" ref={askScrollRef}>
            {turns.length === 0 && !askBusy ? (
              <div className="ask-hello">
                <Image src={ASSETS.mascot} alt="" width={44} height={44} />
                <p className="ask-hello-q">How can I help you today?</p>
                <ul className="ask-suggest">
                  {ASK_CHIPS.map((c) => (
                    <li key={c}>
                      <button
                        onClick={() => {
                          setQuestion("");
                          ask(c);
                        }}
                      >
                        <span>{c}</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              turns.map((t, i) => (
                <div className="ask-turn" key={i}>
                  <div className="ask-q">{t.q}</div>
                  <div className={`ask-a${t.error ? " err" : ""}`}>
                    {t.error ?? (
                      <>
                        {t.filters.length > 0 && (
                          <span className="ask-a-chips">
                            {t.filters.map((f, j) => (
                              <span className="filter-chip" key={j}>
                                {filterLabel(f)}
                              </span>
                            ))}
                          </span>
                        )}
                        {t.note && <span className="ask-a-note">{t.note}</span>}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            {askBusy && (
              <div className="ask-turn">
                <div className="ask-a thinking">
                  <span className="spinner" aria-hidden="true" /> Thinking…
                </div>
              </div>
            )}
          </div>

          <form
            className="ask-input"
            onSubmit={(e) => {
              e.preventDefault();
              setQuestion("");
              ask();
            }}
          >
            <input
              aria-label="Ask a question about the activity log"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about the log…"
              disabled={askBusy}
            />
            <button
              type="submit"
              className="ask-send"
              disabled={askBusy || !question.trim()}
              aria-label="Send question"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5m-7 7 7-7 7 7" />
              </svg>
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
