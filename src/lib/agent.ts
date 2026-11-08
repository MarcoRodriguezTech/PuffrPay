import { getLLM } from "./llm";
import type { OptionPick } from "./llm/types";
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
  reply: string;
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
 *   Call 1 — planSearch: owner message -> {query, maxPriceCents}
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
  // --- server: Channel3 search ---
  let products: ProductResult[] = [];
  try {
    products = await searchProducts(plan.query, plan.maxPriceCents);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ step: "search", detail: `Channel3 error: ${msg.slice(0, 120)}` });
  }
  const affordable = products.filter(
    (p) => p.priceCents <= plan.maxPriceCents
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
  const items = picks
    .map((pk) => {
      const p = affordable.find((x) => x.id === pk.productId);
      return p ? { ...p, tag: pk.tag, reasoning: pk.reasoning } : null;
    })
    .filter((x): x is ProductResult & { tag: string; reasoning: string } => x != null);
  if (items.length === 0) {
    const reply =
      picks.length === 0
        ? `I couldn't find anything under $${(plan.maxPriceCents / 100).toFixed(2)} matching "${plan.query}". Nothing was requested.`
        : `The model picked products that aren't in the results. Nothing was requested.`;
    steps.push({
      step: "pick",
      detail: picks.length === 0 ? "no product fit the budget" : "invalid product ids from model",
    });
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
    text: `Found ${optionsItems.length} picks under $${(plan.maxPriceCents / 100).toFixed(0)} — choose one:`,
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
    "SELECT content FROM chat_messages WHERE id = $1 AND role = 'agent'",
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

  const policy = await getPolicy();
  const spent = await getMonthSpentCents();
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
    "SELECT content FROM chat_messages WHERE id = $1 AND role = 'agent'",
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
    const reply = `"${product.title}" is $${(product.priceCents / 100).toFixed(2)} — ${decision.reason}. Approve or reject it below.`;
    steps.push({ step: "result", detail: "WAITING FOR YOU" });
    await logChat("agent", reply);
    return { steps, reply, purchase, approveUrl: null, stub: false };
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
    "SELECT id, role, content, created_at FROM chat_messages ORDER BY created_at DESC LIMIT $1",
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
