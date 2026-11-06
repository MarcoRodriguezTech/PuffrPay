import { query } from "./db";
import type {
  BudgetInfo,
  Policy,
  PolicyDecision,
  PurchaseRequest,
  PurchaseStatus,
} from "./types";

/* ---------- row mappers ---------- */

interface PolicyRow {
  id: number;
  monthly_cap_cents: number;
  per_purchase_max_cents: number;
  auto_approve_under_cents: number;
  blocked_categories: string[];
  updated_at: Date;
}

function toPolicy(r: PolicyRow): Policy {
  return {
    id: r.id,
    monthlyCapCents: r.monthly_cap_cents,
    perPurchaseMaxCents: r.per_purchase_max_cents,
    autoApproveUnderCents: r.auto_approve_under_cents,
    blockedCategories: r.blocked_categories,
    updatedAt: r.updated_at.toISOString(),
  };
}

interface PurchaseRow {
  id: number;
  created_at: Date;
  product_id: string;
  product_title: string;
  merchant_url: string | null;
  image_url: string | null;
  category: string | null;
  amount_cents: number;
  currency: string;
  agent_reasoning: string | null;
  policy_decision: PolicyDecision;
  policy_reason: string;
  status: PurchaseStatus;
  decided_by: "policy" | "owner";
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  error_message: string | null;
  updated_at: Date;
}

function toPurchase(r: PurchaseRow): PurchaseRequest {
  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    productId: r.product_id,
    productTitle: r.product_title,
    merchantUrl: r.merchant_url,
    imageUrl: r.image_url,
    category: r.category,
    amountCents: r.amount_cents,
    currency: r.currency,
    agentReasoning: r.agent_reasoning,
    policyDecision: r.policy_decision,
    policyReason: r.policy_reason,
    status: r.status,
    decidedBy: r.decided_by,
    paypalOrderId: r.paypal_order_id,
    paypalCaptureId: r.paypal_capture_id,
    errorMessage: r.error_message,
    updatedAt: r.updated_at.toISOString(),
  };
}

/* ---------- policies ---------- */

export async function getPolicy(): Promise<Policy> {
  const rows = await query<PolicyRow>(
    "SELECT * FROM policies ORDER BY id LIMIT 1"
  );
  if (rows.length === 0) {
    throw new Error("No policy row found — run `npm run seed`");
  }
  return toPolicy(rows[0]);
}

export async function updatePolicy(input: {
  monthlyCapCents: number;
  perPurchaseMaxCents: number;
  autoApproveUnderCents: number;
  blockedCategories: string[];
}): Promise<Policy> {
  const rows = await query<PolicyRow>(
    `UPDATE policies SET
       monthly_cap_cents = $1,
       per_purchase_max_cents = $2,
       auto_approve_under_cents = $3,
       blocked_categories = $4,
       updated_at = now()
     WHERE id = (SELECT id FROM policies ORDER BY id LIMIT 1)
     RETURNING *`,
    [
      input.monthlyCapCents,
      input.perPurchaseMaxCents,
      input.autoApproveUnderCents,
      input.blockedCategories,
    ]
  );
  return toPolicy(rows[0]);
}

/* ---------- purchase requests ---------- */

export interface NewPurchaseRequest {
  productId: string;
  productTitle: string;
  merchantUrl: string | null;
  imageUrl?: string | null;
  category: string | null;
  amountCents: number;
  currency?: string;
  agentReasoning: string | null;
  policyDecision: PolicyDecision;
  policyReason: string;
  status: PurchaseStatus;
  decidedBy: "policy" | "owner";
}

export async function createPurchaseRequest(
  p: NewPurchaseRequest
): Promise<PurchaseRequest> {
  const rows = await query<PurchaseRow>(
    `INSERT INTO purchase_requests
       (product_id, product_title, merchant_url, image_url, category, amount_cents, currency,
        agent_reasoning, policy_decision, policy_reason, status, decided_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      p.productId,
      p.productTitle,
      p.merchantUrl,
      p.imageUrl ?? null,
      p.category,
      p.amountCents,
      p.currency ?? "USD",
      p.agentReasoning,
      p.policyDecision,
      p.policyReason,
      p.status,
      p.decidedBy,
    ]
  );
  return toPurchase(rows[0]);
}

/**
 * The newest still-pending request for a product, if one was created in the
 * last 10 minutes — used to stop the agent double-requesting the same item.
 */
export async function findPendingByProduct(
  productId: string
): Promise<PurchaseRequest | null> {
  const rows = await query<PurchaseRow>(
    `SELECT * FROM purchase_requests
     WHERE product_id = $1 AND status = 'WAITING'
       AND created_at > now() - interval '10 minutes'
     ORDER BY created_at DESC LIMIT 1`,
    [productId]
  );
  return rows[0] ? toPurchase(rows[0]) : null;
}

export async function getPurchase(id: number): Promise<PurchaseRequest | null> {
  const rows = await query<PurchaseRow>(
    "SELECT * FROM purchase_requests WHERE id = $1",
    [id]
  );
  return rows[0] ? toPurchase(rows[0]) : null;
}

export async function listPurchases(filters?: {
  status?: PurchaseStatus;
  since?: string;
}): Promise<PurchaseRequest[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters?.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters?.since) {
    params.push(filters.since);
    clauses.push(`created_at >= $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await query<PurchaseRow>(
    `SELECT * FROM purchase_requests ${where} ORDER BY created_at DESC`,
    params
  );
  return rows.map(toPurchase);
}

export async function updatePurchase(
  id: number,
  patch: Partial<{
    status: PurchaseStatus;
    decidedBy: "policy" | "owner";
    paypalOrderId: string | null;
    paypalCaptureId: string | null;
    errorMessage: string | null;
  }>
): Promise<PurchaseRequest> {
  const map: Record<string, string> = {
    status: "status",
    decidedBy: "decided_by",
    paypalOrderId: "paypal_order_id",
    paypalCaptureId: "paypal_capture_id",
    errorMessage: "error_message",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(map)) {
    if (key in patch) {
      params.push(patch[key as keyof typeof patch]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  params.push(id);
  const rows = await query<PurchaseRow>(
    `UPDATE purchase_requests SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $${params.length} RETURNING *`,
    params
  );
  return toPurchase(rows[0]);
}

/* ---------- budget ---------- */

export async function getMonthSpentCents(): Promise<number> {
  const rows = await query<{ total: string | null }>(
    `SELECT sum(amount_cents)::bigint AS total FROM purchase_requests
     WHERE status = 'PURCHASED'
       AND date_trunc('month', created_at) = date_trunc('month', now())`
  );
  return Number(rows[0]?.total ?? 0);
}

export async function getBudget(): Promise<BudgetInfo> {
  const [spentCents, policy] = await Promise.all([
    getMonthSpentCents(),
    getPolicy(),
  ]);
  const capCents = policy.monthlyCapCents;
  return {
    spentCents,
    capCents,
    ratio: capCents > 0 ? spentCents / capCents : 0,
  };
}

/* ---------- chat option sets ---------- */

// Duck-typed mirror of AgentOptionsPayload in agent.ts (repo can't import
// agent — agent already imports repo). Only the fields the dashboard needs.
export interface OptionSetRow {
  id: number;
  createdAt: string;
  items: { id: string; priceCents: number; decision: PolicyDecision }[];
  picked: string | null;
  dismissed: boolean;
}

/**
 * The agent's carousel payloads, most recent first: every chat message whose
 * content is a "kind":"options" JSON blob. Malformed blobs are skipped.
 */
export async function listOptionSets(limit = 200): Promise<OptionSetRow[]> {
  const rows = await query<{ id: number; content: string; created_at: Date }>(
    `SELECT id, content, created_at FROM chat_messages
     WHERE role = 'agent' AND content LIKE '%"kind":"options"%'
     ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  const out: OptionSetRow[] = [];
  for (const r of rows) {
    try {
      const p = JSON.parse(r.content);
      if (p?.kind !== "options" || !Array.isArray(p.items)) continue;
      out.push({
        id: r.id,
        createdAt: r.created_at.toISOString(),
        items: p.items.map((i: { id?: string; priceCents?: number; decision?: string }) => ({
          id: String(i.id ?? ""),
          priceCents: Number(i.priceCents ?? 0),
          decision: (i.decision ?? "ALLOW") as PolicyDecision,
        })),
        picked: typeof p.picked === "string" ? p.picked : null,
        dismissed: p.dismissed === true,
      });
    } catch {
      /* not an options blob */
    }
  }
  return out;
}
