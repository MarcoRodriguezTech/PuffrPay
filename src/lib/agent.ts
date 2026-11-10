import { getLLM } from "./llm";
import type { OptionPick } from "./llm/types";
import { ensurePriceEnds } from "./price-ends";
import { searchProducts } from "./channel3";
import { evaluatePolicy, matchesBlocked } from "./policy";
import type { PolicyDecision } from "./types";
import {
  createPurchaseRequest,
  dismissOpenOptionSets,
  findPendingByProduct,
  getBudget,
  getMonthSpentCents,
  getPolicy,
} from "./repo";
import { startPayment } from "./executor";
import { query } from "./db";
import type { Policy, ProductResult, PurchaseRequest } from "./types";

export interface AgentStep {
  step: string;
  detail: string;
}

export interface AgentRunResult {
  steps: AgentStep[];
  reply: string | null;
  purchase: PurchaseRequest | null;
  /** PayPal sandbox approval URL when payment was started (null for dev stub). */
  approveUrl: string | null;
  /** True when the payment step is the no-credentials dev stub. */
  stub: boolean;
}

/** One card in the options carousel, with its stamped policy verdict. */
export interface OptionsItem extends ProductResult {
  tag: string;
  reasoning: string;
  decision: PolicyDecision;
  decisionReason: string;
}

/** Payload stored in a chat_messages.content JSON blob (kind "options"). */
export interface AgentOptionsPayload {
  v: 1;
  kind: "options";
  text: string;
  items: OptionsItem[];
  /** Cards the owner X'd out — kept so the dashboard still counts them as offered. */
  removed?: OptionsItem[];
  picked?: string;
  dismissed?: boolean;
}

const MAX_OPTIONS = 5;

/**
 * Mode B agent (see README "LLM mode"): two LLM calls, no function calling.
 *   Call 1 — planSearch: owner message -> {query, maxPriceCents},
 *            or {query: null} when the message isn't a shopping request
 *            (chat gets a canned persona reply, no search/purchase).
 *   Server — Channel3 search + price filter
 *   Call 2 — pickProducts: curate up to MAX_OPTIONS varied picks + vibe tags
 *   Server — 1 option: straight through policy -> purchase.
 *            2+ options: stamped with their policy verdict and offered as a
 *            carousel; the owner's pick lands on /api/agent/choose, which runs
 *            the same deterministic policy pipeline (never the LLM).
 * At most 2 LLM calls per shopping request.
 */
export async function runAgent(message: string): Promise<AgentRunResult> {
  const steps: AgentStep[] = [];
  const llm = getLLM();
  const policy = await getPolicy();

  await logChat("owner", message);

  // --- call 1: search plan ---
  let plan;
  try {
    plan = await llm.planSearch(message);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reply = `The agent hit a snag talking to the model (${msg.slice(0, 120)}). Try again in a moment.`;
    await logChat("agent", reply);
    return { steps, reply, purchase: null, approveUrl: null, stub: false };
  }
  // Not searchable — the planner either wrote a clarifying question for a
  // vague shopping ask or answered chit-chat in persona; the canned intro
  // only survives as a fallback. Channel3, policy and PayPal are never
  // touched. If the ask's own budget already busts the per-purchase cap,
  // say so — that's a policy answer, not a search.
  if (!plan.query) {
    // A dropped reply needs the right fallback: the "vague shopping" branch
    // carries a budget, chit-chat reports maxPriceCents 0 — use that to ask
    // a real clarifying question instead of always reciting the intro.
    let reply =
      plan.reply?.trim() ||
      (plan.maxPriceCents > 0
        ? `Over $${(plan.maxPriceCents / 100).toFixed(0)} of what? Name a thing — headphones, a gift, a watch — and I'll go fishing.`
        : "I'm Puffr — a shopping agent that spends inside rules the owner sets. " +
          "Tell me what to find and I'll search for it; the policy engine decides whether the money moves.");
    if (plan.maxPriceCents > policy.perPurchaseMaxCents) {
      reply += ` Heads up though — anything over $${(policy.perPurchaseMaxCents / 100).toFixed(0)} is past your per-purchase max, so the policy engine will say no.`;
    }
    await logChat("agent", reply);
    return { steps, reply, purchase: null, approveUrl: null, stub: false };
  }
  // "over $X" asks are price floors, not budgets — the model's ceiling is a
  // guess, so clamp it deterministically: at least 10× the floor lets the
  // catalog reach the expensive end (policy blocks what's over max anyway).
  const overMatch = message.match(
    /(?:over|more than|above)\s*\$?\s*(\d+(?:\.\d+)?)/i
  );
  const priceFloor = overMatch ? Math.round(parseFloat(overMatch[1]) * 100) : 0;
  if (priceFloor > 0 && plan.maxPriceCents < priceFloor * 10) {
    plan.maxPriceCents = priceFloor * 10;
  }

  // --- server: Channel3 search ---
  let products: ProductResult[] = [];
  try {
    products = await searchProducts(plan.query, plan.maxPriceCents);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "search", detail: `Channel3 error: ${msg.slice(0, 120)}` });
  }
  const affordable = products.filter(
    (p) => p.priceCents <= plan.maxPriceCents && p.priceCents >= priceFloor
  );
  steps.push({
    step: "search",
    detail: `Channel3 '${plan.query}' ... ${products.length} results`,
  });

  // --- call 2: curate options ---
  let picks: OptionPick[];
  try {
    picks = await llm.pickProducts(message, affordable, MAX_OPTIONS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reply = `The agent hit a snag talking to the model (${msg.slice(0, 120)}). Try again in a moment.`;
    await logChat("agent", reply);
    return { steps, reply, purchase: null, approveUrl: null, stub: false };
  }
  // The model curates first; if it returned fewer than a full hand while
  // more candidates exist, top up in Channel3 relevance order so the
  // carousel always offers min(MAX_OPTIONS, catalog size) cards. Then the
  // price bookends are enforced — the cheapest and priciest of the
  // affordable pool always get offered under their reserved tags.
  const seen = new Set<string>();
  const hand = picks
    .map((pk) => {
      const p = affordable.find((x) => x.id === pk.productId);
      return p ? { ...p, tag: pk.tag, reasoning: pk.reasoning } : null;
    })
    .filter(
      (x): x is ProductResult & { tag: string; reasoning: string } =>
        x != null && !seen.has(x.id) && (seen.add(x.id), true)
    );
  const want = Math.min(MAX_OPTIONS, affordable.length);
  for (const p of affordable) {
    if (hand.length >= want) break;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    hand.push({
      ...p,
      tag: "Also found",
      reasoning: "Also matches the request — added to fill the options.",
    });
  }
  const items = ensurePriceEnds(hand, affordable, want);
  if (items.length === 0) {
    const range = priceFloor > 0
      ? `over $${(priceFloor / 100).toFixed(2)}`
      : `under $${(plan.maxPriceCents / 100).toFixed(2)}`;
    const reply = `I couldn't find anything ${range} matching "${plan.query}". Nothing was requested.`;
    steps.push({ step: "pick", detail: "no product fit the budget" });
    await logChat("agent", reply);
    return { steps, reply, purchase: null, approveUrl: null, stub: false };
  }

  const spent = await getMonthSpentCents();

  // A single viable option skips the carousel — straight through the pipeline.
  // The new run owns the shelf: any older still-open carousels are dismissed
  // so their cards resolve to Skipped instead of sitting pickable forever.
  if (items.length === 1) {
    const product = items[0];
    steps.push({
      step: "pick",
      detail: `${product.title} - $${(product.priceCents / 100).toFixed(2)} - ${storeOf(product.merchantUrl)}`,
    });
    await dismissOpenOptionSets();
    return finalizePick(product, product.reasoning, steps, policy, spent);
  }

  // Multiple options: stamp each with its policy verdict and offer the carousel.
  const optionsItems: OptionsItem[] = items.map((p) => {
    const d = evaluatePolicy(
      policy,
      { amountCents: p.priceCents, category: p.category, title: p.title },
      spent
    );
    return {
      id: p.id,
      title: p.title,
      priceCents: p.priceCents,
      currency: p.currency,
      merchantUrl: p.merchantUrl,
      imageUrl: p.imageUrl,
      category: p.category,
      tag: p.tag,
      reasoning: p.reasoning,
      decision: d.decision,
      decisionReason: d.reason,
    };
  });
  steps.push({
    step: "options",
    detail: `${optionsItems.length} options — pick one`,
  });
  steps.push({ step: "result", detail: "WAITING FOR PICK" });
  const reply = JSON.stringify({
    v: 1,
    kind: "options",
    text:
      priceFloor > 0
        ? `Found ${optionsItems.length} picks over $${(priceFloor / 100).toFixed(0)} — choose one:`
        : `Found ${optionsItems.length} picks under $${(plan.maxPriceCents / 100).toFixed(0)} — choose one:`,
    items: optionsItems,
  } satisfies AgentOptionsPayload);
  // The new shelf supersedes any older still-open carousels — dismiss them
  // before this payload lands so only one live set exists at a time.
  await dismissOpenOptionSets();
  await logChat("agent", reply);
  return { steps, reply, purchase: null, approveUrl: null, stub: false };
}

/**
 * The owner picked a card from an options message. The product comes from the
 * stored server-side payload — never trusted from the client — then runs the
 * same dedupe -> policy -> purchase -> payment tail as a direct pick.
 */
export async function chooseOption(
  messageId: number,
  productId: string
): Promise<AgentRunResult> {
  const steps: AgentStep[] = [];
  const rows = await query<{ content: string }>(
    "SELECT content FROM chat_messages WHERE id = $1 AND role = 'agent' AND cleared_at IS NULL",
    [messageId]
  );
  let payload: AgentOptionsPayload | null = null;
  try {
    const parsed = JSON.parse(rows[0]?.content ?? "");
    if (parsed?.kind === "options" && Array.isArray(parsed.items)) {
      payload = parsed as AgentOptionsPayload;
    }
  } catch {
    /* not an options message */
  }
  const item = payload?.items.find((i) => i.id === productId);
  if (!payload || !item) {
    const reply = "Those options expired — ask me again.";
    await logChat("agent", reply);
    return { steps, reply, purchase: null, approveUrl: null, stub: false };
  }

  const [policy, spent] = await Promise.all([getPolicy(), getMonthSpentCents()]);
  const product: ProductResult = {
    id: item.id,
    title: item.title,
    priceCents: item.priceCents,
    currency: item.currency,
    merchantUrl: item.merchantUrl,
    imageUrl: item.imageUrl,
    category: item.category,
  };
  steps.push({
    step: "pick",
    detail: `${product.title} - $${(product.priceCents / 100).toFixed(2)} - ${storeOf(product.merchantUrl)}`,
  });
  const result = await finalizePick(product, item.reasoning, steps, policy, spent);
  try {
    await query("UPDATE chat_messages SET content = $1 WHERE id = $2", [
      JSON.stringify({ ...payload, picked: productId }),
      messageId,
    ]);
  } catch {
    // the picked marker is cosmetic — never fail the purchase on it
  }
  return result;
}

/**
 * Non-pick edits to an options message: dismiss the whole set ("wasn't able
 * to choose") or drop one card (e.g. a blocked option). Persists so the
 * change survives reload. Returns the updated payload, or null if the
 * message isn't a live options set.
 */
export async function updateOptions(
  messageId: number,
  change: { dismiss?: boolean; removeId?: string }
): Promise<AgentOptionsPayload | null> {
  const rows = await query<{ content: string }>(
    "SELECT content FROM chat_messages WHERE id = $1 AND role = 'agent' AND cleared_at IS NULL",
    [messageId]
  );
  let payload: AgentOptionsPayload | null = null;
  try {
    const parsed = JSON.parse(rows[0]?.content ?? "");
    if (parsed?.kind === "options" && Array.isArray(parsed.items)) {
      payload = parsed as AgentOptionsPayload;
    }
  } catch {
    /* not an options message */
  }
  if (!payload || payload.picked) return null;

  if (change.removeId) {
    // Archive rather than delete — the card was still offered, so the
    // dashboard's option-level stats keep counting it.
    const dropped = payload.items.filter((i) => i.id === change.removeId);
    payload.items = payload.items.filter((i) => i.id !== change.removeId);
    payload.removed = [...(payload.removed ?? []), ...dropped];
  }
  if (change.dismiss || payload.items.length === 0) {
    payload.dismissed = true;
  }
  await query("UPDATE chat_messages SET content = $1 WHERE id = $2", [
    JSON.stringify(payload),
    messageId,
  ]);
  return payload;
}

/**
 * Post-pick tail shared by runAgent (single option) and chooseOption (carousel
 * pick): dedupe -> deterministic policy -> purchase row -> ALLOW/ASK/BLOCK.
 */
async function finalizePick(
  product: ProductResult,
  reasoning: string | undefined,
  steps: AgentStep[],
  policy: Policy,
  spent: number
): Promise<AgentRunResult> {
  // Don't queue the same product twice: a WAITING request for it from the
  // last 10 minutes is still live (either owner approval or PayPal checkout).
  const pending = await findPendingByProduct(product.id);
  if (pending) {
    steps.push({ step: "result", detail: "ALREADY WAITING" });
    const reply = `Already waiting on that one — "${product.title}" is still pending.`;
    await logChat("agent", reply);
    return { steps, reply, purchase: pending, approveUrl: null, stub: false };
  }

  // --- deterministic policy engine (never the LLM) ---
  const decision = evaluatePolicy(
    policy,
    {
      amountCents: product.priceCents,
      category: product.category,
      title: product.title,
    },
    spent
  );
  steps.push(
    ...describeChecks(
      policy,
      product.priceCents,
      spent,
      product.category,
      product.title
    )
  );

  const status =
    decision.decision === "BLOCK"
      ? "BLOCKED"
      : decision.decision === "ASK"
        ? "WAITING"
        : "PURCHASED"; // temporary: ALLOW flips to WAITING in startPayment

  let purchase = await createPurchaseRequest({
    productId: product.id,
    productTitle: product.title,
    merchantUrl: product.merchantUrl,
    imageUrl: product.imageUrl,
    category: product.category,
    amountCents: product.priceCents,
    currency: product.currency,
    agentReasoning: reasoning ?? null,
    policyDecision: decision.decision,
    policyReason: decision.reason,
    status,
    decidedBy: "policy",
  });

  if (decision.decision === "BLOCK") {
    const reply = `Blocked: ${decision.reason}. "${product.title}" at $${(product.priceCents / 100).toFixed(2)} can't be bought under the current policy.`;
    steps.push({ step: "result", detail: `BLOCKED: ${decision.reason}` });
    await logChat("agent", reply);
    return { steps, reply, purchase, approveUrl: null, stub: false };
  }

  if (decision.decision === "ASK") {
    // No chat line: the approval card IS the surface. A trace is only added
    // to the feed if the owner dismisses the card with ×.
    steps.push({ step: "result", detail: "WAITING FOR YOU" });
    return { steps, reply: null, purchase, approveUrl: null, stub: false };
  }

  // --- ALLOW: executor creates the PayPal sandbox order ---
  try {
    const exec = await startPayment(purchase);
    purchase = exec.purchase;
    if (purchase.status === "PURCHASED") {
      // Dev stub captured immediately — no real checkout involved.
      steps.push({ step: "result", detail: "BOUGHT" });
      const reply = `Auto-approved and bought "${product.title}" for $${(product.priceCents / 100).toFixed(2)} (sandbox payment).`;
      await logChat("agent", reply);
      return { steps, reply, purchase, approveUrl: null, stub: exec.stub };
    }
    steps.push({ step: "result", detail: "PAYMENT STARTED" });
    const reply = `Auto-approved: "${product.title}" for $${(product.priceCents / 100).toFixed(2)}. Approve it in the PayPal sandbox window and it shows as purchased.`;
    await logChat("agent", reply);
    return { steps, reply, purchase, approveUrl: exec.approveUrl, stub: exec.stub };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logChat("agent", `Payment failed to start: ${msg.slice(0, 160)}`);
    return {
      steps,
      reply: `Policy allowed it, but the payment could not be started: ${msg.slice(0, 160)}`,
      purchase,
      approveUrl: null,
      stub: false,
    };
  }
}

/** Wireframe-style per-check policy log lines with dot leaders. */
function describeChecks(
  policy: Policy,
  amountCents: number,
  monthSpentCents: number,
  category: string | null,
  title: string | null
): AgentStep[] {
  const fmt = (c: number) => `$${(c / 100).toFixed(0)}`;
  const pad = (s: string) => s.padEnd(38, ".");
  const steps: AgentStep[] = [];
  steps.push({
    step: "policy",
    detail: `${pad(`per-purchase max ${fmt(policy.perPurchaseMaxCents)}`)} ${
      amountCents > policy.perPurchaseMaxCents ? "FAIL" : "PASS"
    }`,
  });
  steps.push({
    step: "policy",
    detail: `${pad(
      `monthly cap ${fmt(policy.monthlyCapCents)} (${fmt(monthSpentCents)} used)`
    )} ${monthSpentCents + amountCents > policy.monthlyCapCents ? "FAIL" : "PASS"}`,
  });
  steps.push({
    step: "policy",
    detail: `${pad(`auto-approve under ${fmt(policy.autoApproveUnderCents)}`)} ${
      amountCents <= policy.autoApproveUnderCents ? "YES" : "NO"
    }`,
  });
  if (policy.blockedCategories.length > 0) {
    const hit = matchesBlocked(policy.blockedCategories, { category, title });
    steps.push({
      step: "policy",
      detail: `${pad(`blocked categories: ${policy.blockedCategories.join(", ")}`)} ${
        hit ? "FAIL" : "PASS"
      }`,
    });
  }
  return steps;
}

function storeOf(merchantUrl: string | null): string {
  if (!merchantUrl) return "store";
  try {
    return new URL(merchantUrl).hostname.replace(/^www\./, "");
  } catch {
    return merchantUrl;
  }
}

async function logChat(role: "owner" | "agent" | "system", content: string) {
  try {
    await query("INSERT INTO chat_messages (role, content) VALUES ($1, $2)", [
      role,
      content,
    ]);
  } catch {
    // chat history is best-effort; never block the agent on it
  }
}

export async function getChatHistory(limit = 50) {
  const rows = await query<{
    id: number;
    role: "owner" | "agent" | "system";
    content: string;
    created_at: Date;
  }>(
    "SELECT id, role, content, created_at FROM chat_messages WHERE cleared_at IS NULL ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at.toISOString(),
  }));
}

export { getBudget };
