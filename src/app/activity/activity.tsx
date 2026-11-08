"use client";

// The Activity page: a thin PuffrPay shell around a single AG Studio instance.
// Studio's configuration (data sources, theme, default report) lives in ./studio.
//
// One question box only: when a real LLM is configured (`chatMode === "studio"`)
// the Studio AI chat panel answers questions about the data; otherwise the Ask
// box above the dashboard turns a question into validated page filters. If
// Studio itself fails to load, we fall back to the classic AG Grid view at
// /audit/classic.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import {
  AgStudioAiModule,
  createAiHarness,
  directLlmRunner,
  enableStudioDevValidations,
  type AgReportState,
  type AgStudioApi,
  type AgStudioMode,
  type AgWidgetsConfig,
  type AgAnyAiAgentDefinition,
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

const STORAGE_KEY = "puffrpay:studio-report:v5";
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

// Appended to the built-in data agent's instructions. Deriving a field whose
// alias already exists (e.g. "latest_date") is a fatal validation error that
// tears down the whole dashboard — a unique alias keeps the run alive.
const DATA_AGENT_NOTES =
  "When creating derived fields or transformations, always choose an alias " +
  "that does not already exist as a field name — never reuse an existing " +
  "field name or an alias you have already created; invent a unique name " +
  "instead. If a needed derived field already exists, reuse it rather than " +
  "recreating it. Range filters (e.g. inRelativeRange) require a two-element " +
  "range value — always supply both bounds, never a single date or label.";

// Every <AgStudio> prop below keeps one identity for the page's lifetime.
// Studio re-renders the page on each state update (filter clicks, panel
// toggles, hover selection); fresh objects/handlers on every render made it
// diff and re-apply its configuration each time.
type StudioProps = ComponentProps<typeof AgStudio>;

const STUDIO_STYLE = { height: "auto", width: "100%" } as const;
const STUDIO_LAYOUT = { widgetBorderEnabled: true } as const;
const STUDIO_MODULES = [AgStudioAiModule];

// Studio appends "(sum)" etc. to aggregated field names — the
// column headers and the reference design just want the name.
const STUDIO_LOCALE_TEXT = {
  aggregationSumFieldName: "${name}",
  aggregationAvgFieldName: "${name}",
  aggregationCountFieldName: "${name}",
  aggregationCountdFieldName: "${name}",
};

const STUDIO_PANELS: StudioProps["panels"] = {
  // Dock every panel on the right — the overlay CSS slides
  // expanded panels in from the right edge, and a left-docked
  // panel would render off-screen. `ai` is typed as
  // edit-mode-only but the runtime honours it in view mode too;
  // declaring `view` removes the edit defaults, so both modes
  // are spelled out here.
  //
  // View mode gets only the AI assistant: the Ask box, Leash legend
  // and column headers already cover filtering, and the generic
  // filters panel just exposes denormalized internals (Spent to
  // date, Stub Order, per-row policy caps). Filters stay in edit
  // mode, where composing the report can still need them.
  view: { right: ["ai" as never] },
  edit: { right: ["ai", "filters", "edit", "data"] },
};

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

  // Studio reads initialState once, when it is created. The Ask box and
  // Leash legend do page filtering — the generic filters panel only
  // exists in edit mode.
  const [initialState] = useState(() => {
    const st = reportState.withCollapsedFilters(saved?.state ?? baseReport);
    return {
      ...st,
      panels: {
        ...st.panels,
        // The AI assistant starts collapsed — the floating bubble opens it.
        // A persisted entry means the user left it a certain way; keep it.
        ai: st.panels?.ai ?? { collapsed: true },
        filters: { ...st.panels?.filters, collapsed: true },
      },
    };
  });
  const [studioState, setStudioState] = useState<AgReportState | null>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");

  // Stable Studio event handlers — they only touch refs and state setters.
  const onApiReady = useCallback<NonNullable<StudioProps["onApiReady"]>>((event) => {
    apiRef.current = event.api;
  }, []);
  const onStudioReady = useCallback<NonNullable<StudioProps["onStudioReady"]>>((event) => {
    setStudioState(event.api.getState());
  }, []);
  const onStateUpdated = useCallback<NonNullable<StudioProps["onStateUpdated"]>>((event) => {
    setStudioState(event.state);
  }, []);
  const recoveredOnce = useRef(false);
  const onErrorRaised = useCallback<NonNullable<StudioProps["onErrorRaised"]>>((event) => {
    console.error("[studio] runtime error:", event);
    // A tool — usually the AI data agent — can push an invalid state (e.g. a
    // derived-field alias that collides with an existing field). Restoring
    // the last good report keeps the session alive instead of bouncing the
    // reader to the classic grid mid-chat. If it can't be restored, or a
    // second error hits, fall back.
    const api = apiRef.current;
    if (event.errorType === "validation" && api && !recoveredOnce.current) {
      recoveredOnce.current = true;
      try {
        api.setState(reportState.withCollapsedFilters(saved?.state ?? baseReport));
        return;
      } catch {
        /* restore failed — fall through to the redirect */
      }
    }
    setFailed(true);
  }, [saved, baseReport]);

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
            createAiHarness(api, ({ builtIn }) => ({
              agents: (Object.values(builtIn) as AgAnyAiAgentDefinition[]).map(
                (def) =>
                  directLlmRunner({
                    ...def,
                    adapter: studioChatAdapter,
                    instructions:
                      def.id === "data"
                        ? (ctx, params) =>
                            `${def.instructions?.(ctx, params) ?? ""}\n\n${DATA_AGENT_NOTES}`
                        : def.instructions,
                  })
              ),
              primary: "lead",
              promptStarters: PROMPT_STARTERS,
            }))
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
      api.setState(reportState.withCollapsedFilters(baseReport));
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

  // In studio mode the floating bubble opens Studio's own AI panel instead
  // of the old Ask box — same entry point, the sponsor's assistant behind it.
  const aiPanelOpen = !(state.panels?.ai?.collapsed ?? false);

  // Either chat surface squeezes the page on desktop via the same body class
  // the CSS keys off — the Ask panel and the Studio AI panel are both fixed
  // cards docked to the right edge.
  const dockedChatOpen = askOpen || (chatMode === "studio" && aiPanelOpen);
  useEffect(() => {
    document.body.classList.toggle("ask-open", dockedChatOpen);
    return () => document.body.classList.remove("ask-open");
  }, [dockedChatOpen]);

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

  // Customize mounts into the TopBar's actions slot on wide viewports
  // (the .studio-filters-bar fallback below is hidden there).
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarSlot(document.getElementById("topbar-actions"));
  }, []);

  const openAiPanel = () => {
    const api = apiRef.current;
    const st = api?.getState();
    if (!api || !st) return;
    // One drawer at a time — opening the assistant closes the filters
    // panel too (edit mode still has it).
    api.setState({
      ...st,
      panels: {
        ...st.panels,
        ai: { ...st.panels?.ai, collapsed: false },
        filters: { ...st.panels?.filters, collapsed: true },
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
        </div>
      )}
    </div>
  );

  return (
    <>
      {topbarSlot &&
        createPortal(
          <div className="topbar-activity-controls">{customizeMenu}</div>,
          topbarSlot
        )}

      <div className="studio-filters-bar">{customizeMenu}</div>

      <div className="studio-card">
        {hasData(data) ? (
          <AgStudioProvider licenseKey={licenseKey}>
            <DashRowsContext.Provider value={data.activity}>
            <AgStudio
              key={theme}
              style={STUDIO_STYLE}
              theme={studioTheme}
              layout={STUDIO_LAYOUT}
              data={studioData}
              context={context}
              localeText={STUDIO_LOCALE_TEXT}
              widgets={widgets}
              modules={STUDIO_MODULES}
              panels={STUDIO_PANELS}
              ai={ai}
              initialState={initialState}
              mode={mode}
              onApiReady={onApiReady}
              onStudioReady={onStudioReady}
              onStateUpdated={onStateUpdated}
              onErrorRaised={onErrorRaised}
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

      {chatMode === "studio" && !aiPanelOpen && (
        <button
          className="ask-fab"
          onClick={openAiPanel}
          aria-label="Open AI Assistant"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3z" />
            <path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
            <path d="M5.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
          </svg>
        </button>
      )}

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
                <Image src={ASSETS.mascot} alt="" width={44} height={27} quality={90} style={{ height: "auto" }} />
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
