# PuffrPay

Your AI agent can shop — but only inside the limits you set.

PuffrPay is a web app where an AI shopping agent spends from a PayPal **sandbox**
allowance, strictly inside rules the owner sets. The agent can only *request*
purchases. A deterministic policy engine decides ALLOW / ASK / BLOCK. Every
decision lands in an audit log the owner can search in plain English. A
pufferfish mascot swells and turns red as the monthly budget fills.

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
- **Postgres** — Docker for dev, Render managed Postgres in production. Raw SQL
  migrations (`db/migrations/`) + `scripts/migrate.ts`; no ORM.
- **PayPal REST API, sandbox only** — direct calls from the server
  (`src/lib/paypal.ts`), tokens fetched and cached in code.
- **Channel3** — product search via `@channel3/sdk`, server-side only.
- **Google Gemini/Gemma** — via `@google/genai`, behind a single LLM module.
- **AG Grid Community** — audit log grid.
- **Render** — `render.yaml` blueprint deploys web + Postgres.

## Setup

```bash
cp .env.example .env          # fill in keys (mock works with none)
docker compose up -d postgres # local Postgres on :5433
npm install
npm run migrate
npm run seed                  # default policy + sample rows
npm run dev                   # http://localhost:3000
npm test                      # policy engine unit tests
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
| `GEMINI_MODEL` | model id, e.g. `gemma-4-27b-it` |
| `DATABASE_URL` | Postgres connection string |

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
   sandbox window, the UI calls `POST /api/purchases/:id/capture`, and the
   server captures and stores `paypal_order_id` + `paypal_capture_id`.
3. "Auto-approve" therefore means PuffrPay asks no confirmation, but the PayPal
   sandbox approval click still appears.
4. `PAYPAL_ENV` is hard-checked: anything but `sandbox` throws before a request
   is made. No webhook is needed for this flow. Refunds were left out (not
   required for the demo).
5. With no PayPal keys the executor produces `STUB-*` orders/captures so the
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
- To switch to Mode A later: `gemini-3.5-flash-lite` does support function
  calling — implement the tool loop inside `src/lib/agent.ts` against the same
  `LLM` interface; the policy boundary does not change.

## Audit log natural-language queries

`POST /api/audit/query` sends the question + column list to the LLM, which
returns **JSON only**: `filters`, `sort`, optional `summary` (count/sum). The
server validates it against a whitelist of fields/operators
(`src/lib/audit-query.ts`) — the LLM never writes SQL. The client applies the
spec to AG Grid and prints the summary above it. Answers are cached per
question; mock returns canned filters for dev/tests.

## Data model

`policies` (one demo row), `purchase_requests` (full lifecycle: decision,
reason, status, decided_by, PayPal ids), `chat_messages`. Amounts are integer
cents, USD only. Monthly total counts `PURCHASED` rows in the current calendar
month.

## Screens

- **Agent** — chat + agent log (search, pick, per-check policy results) +
  inline approve/reject + payment step; sidebar with gauge and current rules.
- **Policy** — monthly cap / per-purchase max / auto-approve under / blocked
  categories; queue of WAITING requests with approve/reject.
- **Audit log** — large mascot gauge, NL search box, AG Grid (time, item,
  category, amount, status, reason, reasoning, decided-by, PayPal id).

## Mascot

`PufferGauge` (`src/components/PufferGauge.tsx`) renders
`public/mascot/puffr-placeholder.svg` (original placeholder art — swap the file
or `MASCOT_SRC`). CSS-only states: <50% calm, 50–80% swelling, 80–100% puffed +
red tint, 100% fully puffed + "agent blocked". Numbers and a text label are
always shown; a block triggers a short puff animation.

## Deploy on Render

1. Push to GitHub, then in Render: **New → Blueprint** → pick the repo
   (it reads `render.yaml`, creates the web service + Postgres, and prompts for
   the `sync: false` secrets — paste your PayPal/Channel3/Gemini keys there).
2. The build command runs `npm ci && npm run migrate && npm run seed &&
   npm run build`, so the schema and demo data are ready on first deploy.
3. Set `APP_BASE_URL` to the service URL (e.g.
   `https://puffrpay.onrender.com`) so PayPal's return redirect lands back on
   the app — on Render, `RENDER_EXTERNAL_URL` is used automatically if
   `APP_BASE_URL` is unset, so you can skip it there.
4. The app is live at the Render URL — everything runs in PayPal sandbox.

## Demo script (~2 min)

1. **Policy** screen: cap $200, max $50, auto-approve under $20.
2. **Agent**: "find a birthday gift for my sister, she climbs, under $50" —
   watch the log: search → pick → each policy check.
3. A cheap item auto-approves → finish the sandbox payment → PURCHASED.
   A mid-priced item waits → approve it → payment → PURCHASED (visible in the
   PayPal sandbox dashboard).
4. Ask for something over $50 → BLOCK → the puffer puffs.
5. **Audit log**: "show everything the agent blocked this week" → grid filters.

## Tests

`npm test` runs the policy engine unit tests (14 cases: exactly at each limit,
one cent over, cap-overflow, blocked category, two-in-a-row, $51 blocked,
$19 allowed). The engine is pure code — never an LLM.

## Repo layout

```
src/app            pages (agent, policy, audit) + api routes
src/lib            db, repo, policy engine, executor, agent, llm/*, channel3, paypal, audit-query
src/components     Header, PufferGauge
db/migrations      SQL migrations
scripts            migrate.ts, seed.ts
public/mascot      placeholder pufferfish
render.yaml        Render blueprint
```
