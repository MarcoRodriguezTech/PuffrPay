# PuffrPay

Your AI agent can shop — but only inside the limits you set.

PuffrPay is a web app where an AI shopping agent spends from a PayPal **sandbox**
allowance, strictly inside rules the owner sets. The agent can only *request*
purchases. A deterministic policy engine decides ALLOW / ASK / BLOCK. Every
decision lands in an audit log the owner can search in plain English. A
pufferfish mascot puffs up as the monthly budget fills.

## The one rule that matters

**The agent only requests purchases. Only the purchase executor talks to
PayPal, and it runs only after the policy engine says ALLOW or the owner
approves an ASK.**

```
owner message → agent (LLM) → Channel3 search → pick a product
            → purchase_requests row → POLICY ENGINE (pure code)
            → ALLOW → executor → PayPal sandbox order → buyer approves → capture
            → ASK   → WAITING → owner approves → policy re-check → executor
            → BLOCK → BLOCKED → nothing reaches PayPal
```

Product titles/descriptions from search are untrusted text. Because the policy
engine is separate deterministic code (`src/lib/policy.ts`), a hostile product
description can never cause overspending. No LLM is ever used for an
allow/block/ask decision.

## Tech stack

- **Next.js (App Router) + TypeScript** — one app for UI and API routes.
- **Postgres** — Docker locally (port 5433); any hosted Postgres (e.g. Neon)
  in production. Raw SQL migrations (`db/migrations/`) + `scripts/migrate.ts`;
  no ORM. Deploys to **Vercel**.
- **PayPal REST API, sandbox only** — direct calls from the server
  (`src/lib/paypal.ts`), tokens fetched and cached in code.
- **Channel3** — product search via `@channel3/sdk`, server-side only.
- **Google Gemini/Gemma** — via `@google/genai`, behind a single LLM module.
- **Motion (Framer Motion)** — the option-stack card physics.
- **AG Grid Community** — classic audit grid (fallback view).
- **AG Studio** — the Activity report at `/activity` (data sources,
  relationships, theme and default report in `src/app/activity/studio/`).

## Setup

```bash
cp .env.example .env          # fill in keys (mock works with none)
npm run db:up                 # local Postgres on :5433 via docker compose
npm install
npm run migrate
npm run seed:demo             # polished demo dataset: cap $200, $172 used
npm run dev                   # http://localhost:3000
npm test                      # vitest — policy engine + helpers
npm run build                 # production build
```

Local Postgres runs on port **5433** (5432 is often taken by other projects):
`DATABASE_URL=postgres://postgres:postgres@localhost:5433/puffrpay`

### Environment variables

| Var | Purpose |
|---|---|
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal sandbox app credentials |
| `PAYPAL_ENV` | must be `sandbox` (live is hard-blocked) |
| `CHANNEL3_API_KEY` | Channel3 catalog key |
| `LLM_PROVIDER` | `mock` (default) \| `gemma` \| `gemini` |
| `GEMINI_API_KEY` / `LLM_API_KEY` | Google AI Studio key (either name works) |
| `GEMINI_MODEL` | model id, e.g. `gemini-3.5-flash-lite` |
| `DATABASE_URL` | Postgres connection string |
| `APP_BASE_URL` | public origin for the PayPal return redirect |
| `AG_STUDIO` | AG Studio licence key for `/activity` (optional; a trial key works, and Studio still renders without one) |

No keys at all? The app still runs end-to-end: `LLM_PROVIDER=mock` gives canned
agent/audit behavior, Channel3 falls back to a tiny built-in catalog, and PayPal
payments run as `STUB-*` records. Fill `.env` to go live.

## PayPal flow decision (documented)

Chosen: **Orders v2 create → buyer approves in sandbox → server captures.**

1. Preferred option — saving the buyer's PayPal as a vaulted payment method and
   charging server-side — requires vault eligibility on the merchant account.
   The owner's sandbox accounts (country PH) typically do not have it, and
   there is no API to approve an order as the payer programmatically.
2. So: on ALLOW or owner approval the executor creates a PayPal **sandbox
   order** and the UI surfaces the `approve` link. The buyer approves in the
   sandbox window, and the server captures and stores `paypal_order_id` +
   `paypal_capture_id`.
3. A `reconcileWaiting()` sweep (`POST /api/purchases/reconcile`) runs when the
   Controls page loads and while the agent page has an open checkout: an order
   PayPal reports `APPROVED` gets captured → PURCHASED; a dead order (404) →
   REJECTED "checkout expired on PayPal" — an expired checkout resolves as
   *rejected*, never "skipped" (skipped is only for unchosen option cards).
   Controls also lists open checkouts with Resume / Capture now / Cancel.
4. "Auto-approve" therefore means PuffrPay asks no confirmation, but the PayPal
   sandbox approval click still appears.
5. `PAYPAL_ENV` is hard-checked: anything but `sandbox` throws before a request
   is made. No webhook is needed for this flow. Refunds were left out (not
   required for the demo).
6. With no PayPal keys the executor produces `STUB-*` orders/captures so the
   full flow is demoable offline — clearly marked in the UI and README.

## LLM mode decision (documented)

Chosen: **Mode B — two JSON-only calls, no function calling.**

Provider test (`npx tsx scripts/test-llm.ts`, on the owner's Google AI Studio
key):

| Model | JSON-only output | Function calling |
|---|---|---|
| `gemma-4-26b-a4b-it` | 200, but rambling meta-text | 500 — not supported |
| `gemma-4-31b-it` | 500 on `responseMimeType` JSON mode | 500 — not supported |
| `gemini-2.5-flash-lite` | 404 — deprecated for this key | 404 |
| **`gemini-3.5-flash-lite`** | **200, clean JSON** | **200 — works** |

Gemma 4 cannot do function calling (HTTP 500) and chokes on forced JSON mode,
so Mode A is out. **Recommended `GEMINI_MODEL=gemini-3.5-flash-lite`** — clean
JSON confirmed. The provider deliberately does not set `responseMimeType`
(the request that 500s Gemma); prompts demand JSON and `extractJson` tolerates
fences/prose.

- Provider via `LLM_PROVIDER`: `mock` (default; deterministic canned responses —
  all tests and normal dev use it), `gemma`, or `gemini` (both route to the same
  `GeminiLLM`; `GEMINI_MODEL` picks the model). Retries with backoff on 429 and
  fails with a friendly message. Mode B spends ≤2 calls per shopping request and
  1 per audit question — important on the tight free tier (~20/day).
- Shopping asks can carry a **price floor**: "find something over $100" clamps
  the search ceiling to ≥10× the floor and filters results to ≥ floor — that's
  how the "smartwatch over $100" chip demos BLOCK-stamped cards.
- Casual chat ("hi", "thanks") never triggers a product search — the planner
  returns a reply instead of a query; vague shopping asks get a clarifying
  question rather than a silent search.
- To switch to Mode A later: `gemini-3.5-flash-lite` does support function
  calling — implement the tool loop inside `src/lib/agent.ts` against the same
  `LLM` interface; the policy boundary does not change.

## Natural-language queries

There is exactly one question box:

- When a real LLM is configured (`LLM_PROVIDER` gemma/gemini + key), the
  Activity page uses the **AG Studio chat panel**; turns are proxied through
  `POST /api/chat` so the key never reaches the browser.
- Otherwise a single **Ask box** above the dashboard turns a question into
  validated page filters via `POST /api/audit/query`. The same endpoint backs
  the Ask box on the classic log.

`POST /api/audit/query` sends the question + column list to the LLM, which
returns **JSON only**: `filters`, `sort`, optional `summary` (count/sum). The
server validates it against a whitelist of fields/operators
(`src/lib/audit-query.ts`) — the LLM never writes SQL. Answers are cached per
question; mock returns canned filters for dev/tests.

## Data model

`policies` (one demo row), `purchase_requests` (full lifecycle: decision,
reason, status, decided_by, PayPal ids), `chat_messages`. Amounts are integer
cents, USD only. Monthly total counts `PURCHASED` rows in the current calendar
month.

`chat_messages` is dual-purpose: it backs the agent feed **and** stores option
sets as `kind:"options"` payloads — those payloads power the Activity card
layer (offered / picked / skipped / blocked stats). **New chat** doesn't
delete anything: rows get a `cleared_at` stamp (migration
`003_chat_cleared.sql`) so the feed resets while the audit trail stays intact.
Migrations apply alphabetically: `001_init`, `002_product_image`,
`003_approve_url`, `003_chat_cleared`.

## Screens

- **Agent** (`/`) — chat + agent receipt log + the **OptionStack**: a
  drag-to-browse card stack of ≤5 products with Cheapest/Priciest bookends,
  per-card × removal, a bail-out × on the whole set, and blocked cards that
  show their reason as a pill instead of a pick button. Asks made *this
  session* pop a "Puffr needs your OK" approval card; asks that were already
  queued show a quiet "decide it in Controls" note (muted via the × and
  suppressed while a shelf is live). The rail's **New** segment under Agent
  expands on Agent click and archives the conversation (`cleared_at` — feed
  resets, Activity keeps history, pending approvals survive). Composer has
  browser voice dictation. `/agent` redirects here.
- **Controls** (`/policy`) — rules ruler + monthly cap / per-purchase max /
  auto-approve under / blocked categories, a "Would this be allowed?" dry-run
  panel, the queue of WAITING requests with approve/reject, and open PayPal
  checkouts with Resume / Capture now / Cancel (the reconcile sweep runs on
  load).
- **Activity** (`/activity`) — the AG Studio report over `purchase_requests` +
  the option-set card layer: KPI tiles (Spent / Kept by the leash / Requests /
  Bought), a stepped "Spending this month" chart, Spend-by-day bars, the Leash
  report (offered / picked / blocked counters), and the combined **Fun money +
  Recent activity** hero card with the swimming mascot gauge. Clicking status
  chips or leash segments drills the grid + card layer down while gauges,
  KPIs and global budget metrics stay global. Editable via Customize; the
  report persists to localStorage. If Studio fails to load the page falls back
  to the classic log.
- **Classic log** (`/audit/classic`) — the plain AG Grid view, peer of Activity
  via the topbar view-toggle: mascot gauge with the fish-states legend
  (0–50 / 50–80 / 80–99 / 100%), Ask box, sortable/filterable grid and a row
  detail drawer. `/audit` and `/dashboard` redirect to `/activity`.

## Mascot & owner avatar

`PufferGauge` (`src/components/PufferGauge.tsx`) renders one transparent PNG
per budget state from `public/mascot/`: `puffr-calm-v4.png` (<50%),
`puffr-swelling-v4.png` (50–80%), `puffr-puffed-v2.png` (80–90%),
`puffr-super-puffed-v2.png` (90–100% and ≥100% maxed, plus a red tint + "Max"
tag). `puffr-v2.png` is the default art for static uses (favicon, error/404,
empty states). Files carry a `-vN` suffix so a new render never hits a cached
`/_next/image` rendition — bump it on each art swap. The gauge still bobs,
pops on a block, and blows bubbles; motion respects `prefers-reduced-motion`.

The owner avatar lives at `public/avatar/owner.png` — shown in the topbar chip;
falls back to "PP" initials if the file 404s.

## Demo script (~2 min)

Reset the data first with `npm run reset:demo` (or `npm run seed:demo` on an
empty DB): cap $200, per-purchase max $50, auto-approve under $20, $172 used.

1. **Agent** (`/`): "find a birthday gift for my sister, she climbs, under $50" —
   watch the receipt: search → pick → each policy check, then browse the card
   stack (drag it; end cards show Cheapest/Priciest).
2. A cheap item auto-approves → finish the sandbox payment → PURCHASED.
   A mid-priced item waits → approve it → payment → PURCHASED (visible in the
   PayPal sandbox dashboard).
3. Tap the **"Find me a smartwatch over $100"** chip → every card lands over
   the per-purchase max → BLOCK → the puffer puffs.
4. **Controls** (`/policy`): move the fields and watch the rules ruler update;
   try "Would this be allowed?" on $75; the checkout queue shows open PayPal
   checkouts (resume/cancel).
5. **Activity** (`/activity`): the Studio report — "Kept by the leash" KPI,
   spend chart, leash report and the requests grid. Ask "blocked this week" in
   the question box → the report filters. Click a leash segment to drill the
   grid down.
6. **New chat** (rail, under Agent): clears the feed for the next run — earlier
   activity stays in Activity.

## Tests

`npm test` runs vitest — 36 cases across `src/lib/policy.test.ts` (engine
boundaries: exactly at each limit, one cent over, cap-overflow, blocked
category, two-in-a-row), `src/lib/gemini-schema.test.ts` (LLM JSON parsing),
and `src/lib/price-ends.test.ts` (Cheapest/Priciest bookend logic). The engine
is pure code — never an LLM.

## Repo layout

```
src/app            pages (agent /, policy, activity, audit/classic) + api routes
src/app/activity   AG Studio report: studio/{ai-adapter,ask,bento-widgets,cell-renderers,data,initial-report,theme} + client shell
src/lib            db, repo, policy engine, executor, agent, llm/*, channel3, paypal, audit-query, audit-filters, dashboard-data, price-ends, status, ui, gemini-schema, api-error, assets, theme, types
src/components     SideRail, TopBar, ThemeToggle, PufferGauge, LeashBar, OptionStack, ReceiptsDrawer, ReceiptCard, StatusBadge, Toaster
db/migrations      SQL migrations (applied alphabetically)
scripts            migrate.ts, seed.ts, test-llm.ts, test-provider.ts
public/mascot      pufferfish art (calm / swelling / puffed / super + default, -vN suffixed)
public/avatar      owner avatar
```
