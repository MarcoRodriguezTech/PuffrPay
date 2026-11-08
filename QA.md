# PuffrPay QA — test cases & gap analysis

Manual QA checklist for the whole app. Nothing here changes code — this is for
walking the site, marking pass/fail, and deciding what to fix.

Environment modes that change expected behavior:

| Flag | When set | When unset |
|---|---|---|
| `CHANNEL3_API_KEY` | Live Channel3 catalog search | 5-item fallback catalog (chalk bag $34, trail mix $18, headphones $82, bottle $45, gift card $60) |
| `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` | Real sandbox orders; "Awaiting PayPal" reachable | Stub: instant capture, skips "Awaiting PayPal" entirely |
| LLM provider | Real model planning/curation | Mock mode — reasoning strings start with `[mock]` |

Canonical statuses (`src/lib/status.tsx`): `Bought` · `Awaiting PayPal` (WAITING+ALLOW, checkout open) · `Waiting for you` (WAITING+ASK, needs owner) · `Blocked` · `Rejected` · `Failed`.

Policy order (`src/lib/policy.ts`): blocked category → per-purchase max → monthly cap → auto-approve under → ASK. First match wins.

---

## A. Agent chat → options flow (`/`)

| ID | Scenario | Expected |
|---|---|---|
| A1 | Send "buy me a yoga mat under $40" | Steps receipt shows search → pick → options; carousel appears with ≤5 cards, each with tag, price, verdict chip |
| A2 | Request where search returns exactly 1 viable item | No carousel — goes straight through policy → purchase (no "options" step) |
| A3 | Request where nothing fits budget | Reply "couldn't find anything…", no carousel, no purchase row |
| A4 | LLM down/misbehaving (planSearch throws) | Friendly snag message, steps stop, no crash |
| A5 | LLM returns product ids not in results | "model picked products that aren't in the results", no purchase |
| A6 | Channel3 error mid-run | Step logs "Channel3 error…", run continues/fails gracefully |
| A7 | Empty/whitespace message | Input blocks send (button disabled) or API 400 |
| A8 | Send while previous run in flight | Input disabled while `busy` |
| A9 | Rapid duplicate requests for same product | Second run: "Already waiting on that one" (10-min dedupe window) |

## B. Options carousel (OptionStack + older OptionCarousel)

| ID | Scenario | Expected |
|---|---|---|
| B1 | Click "Pick this" on an ALLOW card | Policy pipeline runs → purchase row → payment step; payload records `picked` |
| B2 | Click "Pick this" on an ASK card | Purchase row WAITING+ASK → "Waiting for you"; approve/reject UI appears |
| B3 | BLOCKED card | No pick button, shows blocked reason; only removable via × |
| B4 | × a card | Card leaves the stack AND is archived to `payload.removed` (check DB: `removed` array grows, `items` shrinks) |
| B5 | × every card in the set | Set auto-dismisses; chat shows "Skipped — nothing picked" |
| B6 | Dismiss whole set (bail-out ×) | `dismissed: true`; message collapses to "Skipped — nothing picked" |
| B7 | Reload page mid-carousel | Stack still live, removal/dismiss state persisted from DB |
| B8 | Old unpicked sets in history | Render as flat OptionCarousel — verify whether old sets should still be pickable (see GAP-8) |
| B9 | Picked set in history | Collapses to single picked card with "Picked" chip |
| B10 | Pick card A, then replay POST `/api/agent/choose` with card B's id on the SAME set | See GAP-4 — currently creates a second purchase |
| B11 | Reduced-motion OS setting | OptionStack renders plain scrollable fallback row, all actions still work |
| B12 | Two different open sets, pick one card from each | Two purchases — decide if allowed (see GAP-9) |

## C. Controls page (`/policy`) + engine + simulate

| ID | Scenario | Expected |
|---|---|---|
| C1 | Load page | Current values shown (monthly cap, per-purchase max, auto-approve under, blocked categories) |
| C2 | Save new limits | Persisted; next request uses them; sidebar limits update |
| C3 | Set per-purchase max below a request's price | That request BLOCKs "over per purchase max" |
| C4 | Add a category to blocked list | Matching products BLOCK "blocked category" — including cards already inside a carousel |
| C5 | Lower monthly cap below spent+amount | BLOCK "would exceed monthly cap" |
| C6 | Amount ≤ auto-approve under | ALLOW "under auto approve limit" |
| C7 | Amount between auto-approve and per-purchase max | ASK "needs owner approval" |
| C8 | Simulate endpoint with edge amounts (0, negative, exactly at limits, cap boundary) | Correct decision each boundary (off-by-one check: `>` vs `>=` — max is inclusive, auto-approve inclusive) |
| C9 | Category matching case/whitespace | " Gift Cards " blocks "gift cards" (trim + lowercase both sides) |
| C10 | No `item.category` (null) | Blocked-category rule skipped; other rules still apply |

## D. Owner approval (approve / reject)

| ID | Scenario | Expected |
|---|---|---|
| D1 | Approve WAITING+ASK, policy still passes | `decidedBy: owner`, payment starts → Awaiting PayPal (real) or Bought (stub) |
| D2 | Approve ASK after monthly cap filled since request | Re-check BLOCKs → status BLOCKED, errorMessage "blocked on re-check: …", toast shows reason |
| D3 | Reject WAITING+ASK | Status REJECTED, `decidedBy: owner`, toast "Rejected" |
| D4 | Approve/reject a non-WAITING row (replay request) | API error, no state change |
| D5 | Reject a row that already has `paypalOrderId` | API error "already has a payment in progress" |
| D6 | Double-click Approve fast | One order only — second call hits "payment in progress" or not-found guard |
| D7 | Approve card that was picked, then X'd… | (removeId can't hit picked sets — verify updateOptions returns null on picked payload) |

## E. PayPal executor + `/paypal/return`

| ID | Scenario | Expected |
|---|---|---|
| E1 | Stub mode (no creds): pick ALLOW card | Instant PURCHASED + STUB- ids; "Bought" immediately, never "Awaiting PayPal" |
| E2 | Real mode: pick ALLOW card | WAITING + real orderId + approveUrl → "Awaiting PayPal"; "Open PayPal sandbox" link shown |
| E3 | Approve in sandbox, click "I've approved — capture now" | captureOrder → PURCHASED + captureId, toast "Payment sent (sandbox)" |
| E4 | Click capture BEFORE approving in sandbox | ORDER_NOT_APPROVED → stays WAITING, friendly "finish it in the PayPal window" hint, retryable |
| E5 | `/paypal/return?token=<orderId>` after approving | Auto-captures → success screen with capture id |
| E6 | `/paypal/return` with missing/garbage token | Error state, no capture, purchase untouched |
| E7 | captureOrder throws a non-retryable error | Status FAILED + errorMessage (terminal) |
| E8 | PayPal API down at createOrder time | See GAP-1 — purchase row may stay phantom-PURCHASED |
| E9 | Order approved in sandbox but never captured for days | Fixed via GAP-2 — the next queue load/sweep captures it (or expires a dead order) |

## F. Dedupe

| ID | Scenario | Expected |
|---|---|---|
| F1 | Same product requested again <10 min while WAITING | "Already waiting on that one", no new row |
| F2 | Same product >10 min later | New request allowed — is this desired? (GAP-10) |
| F3 | Same product, previous row BLOCKED/REJECTED | New request allowed (dedupe only matches WAITING) |

## G. Sidebar gauge + budget

| ID | Scenario | Expected |
|---|---|---|
| G1 | Fresh month | Gauge shows spent/cap, correct % and STATE_LABEL |
| G2 | New PURCHASED row | Gauge + "Fun money" tile update on refresh |
| G3 | Over cap | Gauge maxed, blocked state shown (mascot super-puffed) |
| G4 | WAITING amounts | Do NOT count toward spend (only PURCHASED) — verify intended |

## H. Activity dashboard (`/activity`)

| ID | Scenario | Expected |
|---|---|---|
| H1 | Load | 7 widgets + KPI tiles + grid render; no skeleton veil blocking clicks |
| H2 | Purchases grid | Rows newest-first; status badges correct per canonical map |
| H3 | Pager "Next ›" | Filters `rowIdx` → page 2 content; "Page N of M" accurate |
| H4 | Range pills Week/Month/All | Spend trend x-domain changes; active pill highlights |
| H5 | Click leash bar segment | Applies status page filter; segment `aria-pressed`, other widgets/grid filter |
| H6 | Click same segment again | Filter clears |
| H7 | Click legend row | Same toggle as segment |
| H8 | Ask box NL filter → status filter | Leash `active` mirrors ask-set status filter |
| H9 | New purchase arrives, reload | `rowIdx` re-ranks (newest = 1) — pager page contents shift (GAP-11) |
| H10 | Studio edit/layout interactions | Widgets draggable/resizable in edit mode; skeleton overlay never eats clicks |
| H11 | Report state persistence | Layout/filters survive reload (localStorage); "dirty" indicator behaves |
| H12 | Theme toggle dark/light | All glass surfaces + leash palette readable both modes |

## I. Leash report (per-option counting)

Formulas: `offered = pass + ask + blocked = picked + skipped + open`
skipped = X'd cards + all cards in dismissed sets + unchosen leftovers of picked sets.

| ID | Scenario | Expected |
|---|---|---|
| I1 | Any state | Both identities reconcile exactly on screen |
| I2 | × one card from open set | Offered UNCHANGED, open −1, skipped +1, verdicts unchanged |
| I3 | Dismiss a set of N live cards | skipped += N (not +1) |
| I4 | Pick 1 of 5 | picked +1; other 4 → skipped |
| I5 | × a BLOCKED card | "Stopped by the rules" still counts it (verdict archived) |
| I6 | New set created | offered += N, open += N |
| I7 | Zero state | "No suggestions yet" empty state |
| I8 | Old sets (pre-archive payloads) | Count live items only — historical undercount is known (GAP-5) |
| I9 | Labels | "Options offered" / "Options you picked"; footer two lines: verdicts then outcomes |

## J. Audit classic (`/audit/classic`)

| ID | Scenario | Expected |
|---|---|---|
| J1 | Load | Grid of purchase_requests, gauge sidebar |
| J2 | Chip "blocked this week" | NL → spec → filtered grid, `filterLabel` shown |
| J3 | "total spent this month" | Aggregate answer correct vs DB sum of PURCHASED |
| J4 | "waiting for approval" | Only WAITING+ASK rows |
| J5 | Gibberish question | 422 "unparseable" → friendly message, no crash |
| J6 | LLM rate-limited | Friendly rate-limit message |

## K. Redirects & misc

| ID | Scenario | Expected |
|---|---|---|
| K1 | `/agent` → `/`, `/dashboard` → `/activity`, `/audit` → `/activity` | Redirects work |
| K2 | 404 page | Renders, navigable |
| K3 | Chat history persistence | Messages incl. options payloads survive reload (`GET /api/chat` wait — it's POST-only; history loads on page render) |
| K4 | `/policy` hydration | Watch console — a caret SSR/client mismatch was seen earlier (GAP-13) |

## L. Cross-cutting / edge cases

| ID | Scenario | Expected |
|---|---|---|
| L1 | DB unreachable | Pages error gracefully (error.tsx), no raw stack to user |
| L2 | Two browser tabs shop concurrently | No corruption; monthly-cap race possible (GAP-9) |
| L3 | Very long product titles/merchant URLs | Cards/grid don't overflow |
| L4 | `listOptionSets` cap (200) | >200 sets → oldest invisible to leash; acceptable? |
| L5 | Payload `removed` on choose attempt | Removed card cannot be picked (not in `items`) |
| L6 | Memory: long session, many messages | `optionsCache` unbounded growth (GAP-14, minor) |

---

## Findings — suspected bugs & gaps (triage these)

| # | Severity | Issue |
|---|---|---|
| GAP-1 | **high** | `finalizePick` writes `status: PURCHASED` *before* `startPayment`. If `createOrder` throws (PayPal outage), the row stays PURCHASED with no order/capture — a phantom "Bought" that **inflates monthly spend**. (`agent.ts` ~line 304 vs executor catch) |
| GAP-2 | ~~high~~ **fixed** | ~~"Awaiting PayPal" never expires~~ → `reconcileWaiting()` sweeps open checkouts on every `/policy` load and every 8s while the agent page shows an open checkout (`POST /api/purchases/reconcile`): PayPal `APPROVED` → capture → PURCHASED, dead order (404) → REJECTED "checkout expired", CREATED → untouched. Manual "Capture now" buttons removed — approval in the sandbox window resolves on its own. |
| GAP-3 | ~~medium~~ **fixed** | ~~No in-app cancel once an order exists~~ → `paypal_approve_url` is now persisted (migration 002, backfilled), open checkouts appear under "AWAITING PAYPAL" in the `/policy` queue with Resume / Capture now / Cancel (`cancelPurchase` → REJECTED). `capturePurchase` also guards `status !== "WAITING"` so cancelled rows can't resurrect via a stale PayPal tab. |
| GAP-4 | **high** | `chooseOption` does not check `payload.picked` — replaying `/api/agent/choose` with a different card id on an already-picked set creates a **second purchase**. UI disables buttons but the endpoint itself is unguarded. |
| GAP-5 | low (data) | Pre-change payloads lost their X'd cards permanently — leash "offered/skipped" undercounts old sets. Unrecoverable; going forward is correct. |
| GAP-6 | question | Leash report ignores page/date filters entirely (reads raw rows + sets). Decide whether funnel stats should respond to range pills / ask-box filters. |
| GAP-7 | low | X'ing the last card auto-dismisses the set — fine, but confirm "Skipped — nothing picked" copy is wanted when user deliberately removed each card. |
| GAP-8 | question | Every old unpicked set stays pickable forever (OptionCarousel buttons live). Carousels have no TTL — "still open" count grows unboundedly. |
| GAP-9 | medium | Concurrency: two picks (different sets or tabs) or two auto-approvals can both pass the monthly-cap check — cap compares against PURCHASED only, not WAITING. |
| GAP-10 | low | Dedupe only covers WAITING within 10 min — a BLOCKED or old WAITING product can be re-requested into another row immediately. |
| GAP-11 | low | `rowIdx` is newest-first rank — new purchases shift every row's rank, so pager page contents drift between loads. |
| GAP-12 | low | `approveAndExecute` BLOCK-on-recheck keeps `decidedBy: "policy"` — probably right (owner never decided) but confirm display reads sensibly. |
| GAP-13 | low | Hydration mismatch seen on `/policy` earlier (caret style SSR/client diff) — unconfirmed; check console. |
| GAP-14 | trivial | `optionsCache` in page.tsx is an unbounded Map keyed by message content — grows with history length. |
| GAP-15 | question | `listOptionSets` LIKE-match + LIMIT 200: sets beyond 200 silently drop out of leash stats. |

## Suggested first triage

1. **GAP-4** (double-purchase) — cheap fix, real money-path bug.
2. **GAP-1** (phantom PURCHASED) — corrupts spend totals; the cap then mis-decides future requests.
3. ~~GAP-2/GAP-3~~ — both fixed: reconcile sweep expires dead orders and captures approved ones.
4. **GAP-6** — product question: should leash numbers follow the date filters?
