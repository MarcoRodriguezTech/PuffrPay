import { getLLM } from "./llm";
import { searchProducts } from "./channel3";
import { evaluatePolicy } from "./policy";
import {
  createPurchaseRequest,
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

/**
 * Mode B agent (see README "LLM mode"): two LLM calls, no function calling.
 *   Call 1 — planSearch: owner message -> {query, maxPriceCents}
 *   Server — Channel3 search + price filter
 *   Call 2 — pickProduct: pick one product + one-line reasoning
 *   Server — create purchase request, run deterministic policy engine
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

  // --- call 2: pick ---
  const pick = await llm.pickProduct(message, affordable);
  if (!pick) {
    const reply = `I couldn't find anything under $${(plan.maxPriceCents / 100).toFixed(2)} matching "${plan.query}". Nothing was requested.`;
    steps.push({ step: "pick", detail: "no product fit the budget" });
    await logChat("agent", reply);
    return { steps, reply, purchase: null, approveUrl: null, stub: false };
  }
  const product = affordable.find((p) => p.id === pick.productId);
  if (!product) {
    const reply = `The model picked a product that isn't in the results. Nothing was requested.`;
    steps.push({ step: "pick", detail: "invalid product id from model" });
    await logChat("agent", reply);
    return { steps, reply, purchase: null, approveUrl: null, stub: false };
  }
  steps.push({
    step: "pick",
    detail: `${product.title} - $${(product.priceCents / 100).toFixed(2)} - ${storeOf(product.merchantUrl)}`,
  });

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
  const spent = await getMonthSpentCents();
  const decision = evaluatePolicy(
    policy,
    { amountCents: product.priceCents, category: product.category },
    spent
  );
  steps.push(
    ...describeChecks(policy, product.priceCents, spent, product.category)
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
    agentReasoning: pick.reasoning,
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
  category: string | null
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
    const hit =
      category != null &&
      policy.blockedCategories
        .map((c) => c.trim().toLowerCase())
        .includes(category.trim().toLowerCase());
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
