import { createOrder, captureOrder } from "./paypal";
import { query } from "./db";
import { getPurchase, updatePurchase, getMonthSpentCents, getPolicy } from "./repo";
import { evaluatePolicy } from "./policy";
import type { PurchaseRequest } from "./types";

/**
 * The purchase executor is the ONLY code path that talks to PayPal.
 * It runs after the policy engine returns ALLOW, or after the owner
 * approves a WAITING request (with a fresh policy check first).
 *
 * When PayPal credentials are not configured (local dev without keys),
 * a stub order/capture is produced so the whole flow still works — see README.
 */

export function paypalConfigured(): boolean {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
  );
}

export interface ExecuteResult {
  purchase: PurchaseRequest;
  approveUrl: string | null;
  stub: boolean;
}

/** Create a PayPal sandbox order (or dev stub) for a purchase request. */
export async function startPayment(purchase: PurchaseRequest): Promise<ExecuteResult> {
  if (!paypalConfigured()) {
    const stubOrderId = `STUB-ORDER-${purchase.id}-${Date.now()}`;
    const updated = await updatePurchase(purchase.id, {
      paypalOrderId: stubOrderId,
      status: "WAITING",
    });
    return { purchase: updated, approveUrl: null, stub: true };
  }

  const order = await createOrder({
    amountCents: purchase.amountCents,
    currency: purchase.currency,
    description: purchase.productTitle,
    customId: String(purchase.id),
  });
  const updated = await updatePurchase(purchase.id, {
    paypalOrderId: order.orderId,
    status: "WAITING",
  });
  return { purchase: updated, approveUrl: order.approveUrl, stub: false };
}

/**
 * Owner approved a WAITING (ASK) request: re-run the policy engine first —
 * the monthly total may have changed since the request was created.
 */
export async function approveAndExecute(id: number): Promise<ExecuteResult> {
  const purchase = await getPurchase(id);
  if (!purchase) throw new Error(`purchase ${id} not found`);
  if (purchase.status !== "WAITING" || purchase.policyDecision !== "ASK") {
    throw new Error(`purchase ${id} is not waiting for owner approval`);
  }
  if (purchase.paypalOrderId) {
    throw new Error(`purchase ${id} already has a payment in progress`);
  }

  const [policy, spent] = await Promise.all([getPolicy(), getMonthSpentCents()]);
  const fresh = evaluatePolicy(
    policy,
    { amountCents: purchase.amountCents, category: purchase.category },
    spent
  );
  if (fresh.decision === "BLOCK") {
    const blocked = await updatePurchase(id, {
      status: "BLOCKED",
      errorMessage: `blocked on re-check: ${fresh.reason}`,
    });
    return { purchase: blocked, approveUrl: null, stub: false };
  }

  await updatePurchase(id, { decidedBy: "owner" });
  return startPayment(purchase);
}

/** Owner rejected a WAITING request. */
export async function rejectPurchase(id: number): Promise<PurchaseRequest> {
  const purchase = await getPurchase(id);
  if (!purchase) throw new Error(`purchase ${id} not found`);
  if (purchase.status !== "WAITING" || purchase.policyDecision !== "ASK") {
    throw new Error(`purchase ${id} is not waiting for owner approval`);
  }
  if (purchase.paypalOrderId) {
    throw new Error(
      `purchase ${id} already has a payment in progress — cancel it in PayPal instead`
    );
  }
  return updatePurchase(id, { status: "REJECTED", decidedBy: "owner" });
}

/**
 * Capture after buyer approval. For stub orders, marks PURCHASED directly.
 * Returns the updated purchase; throws on PayPal errors (row marked FAILED).
 */
export async function capturePurchase(id: number): Promise<PurchaseRequest> {
  const purchase = await getPurchase(id);
  if (!purchase) throw new Error(`purchase ${id} not found`);
  if (!purchase.paypalOrderId) {
    throw new Error(`purchase ${id} has no PayPal order to capture`);
  }
  if (purchase.status === "PURCHASED") return purchase;

  if (purchase.paypalOrderId.startsWith("STUB-ORDER-")) {
    return updatePurchase(id, {
      status: "PURCHASED",
      paypalCaptureId: `STUB-CAPTURE-${purchase.id}`,
      errorMessage: null,
    });
  }

  try {
    const result = await captureOrder(purchase.paypalOrderId);
    return await updatePurchase(id, {
      status: "PURCHASED",
      paypalCaptureId: result.captureId,
      errorMessage: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // ORDER_NOT_APPROVED is transient (buyer hasn't finished yet) — leave the
    // row WAITING so the capture can be retried; anything else is a real failure.
    if (!message.includes("ORDER_NOT_APPROVED")) {
      await updatePurchase(id, { status: "FAILED", errorMessage: message });
    }
    throw err;
  }
}

export async function getPurchaseByOrderId(
  orderId: string
): Promise<PurchaseRequest | null> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM purchase_requests WHERE paypal_order_id = $1 LIMIT 1",
    [orderId]
  );
  return rows[0] ? getPurchase(rows[0].id) : null;
}
