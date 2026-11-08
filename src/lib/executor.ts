import { createOrder, captureOrder, getOrderStatus } from "./paypal";
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
    // Dev stub: no real checkout exists, so the order captures immediately.
    const stubOrderId = `STUB-ORDER-${purchase.id}-${Date.now()}`;
    await updatePurchase(purchase.id, {
      paypalOrderId: stubOrderId,
      status: "WAITING",
    });
    const captured = await capturePurchase(purchase.id);
    return { purchase: captured, approveUrl: null, stub: true };
  }

  const order = await createOrder({
    amountCents: purchase.amountCents,
    currency: purchase.currency,
    description: purchase.productTitle,
    customId: String(purchase.id),
  });
  const updated = await updatePurchase(purchase.id, {
    paypalOrderId: order.orderId,
    paypalApproveUrl: order.approveUrl,
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
      `purchase ${id} already has a payment in progress — use Cancel in the queue instead`
    );
  }
  return updatePurchase(id, { status: "REJECTED", decidedBy: "owner" });
}

/**
 * Owner cancelled an open checkout. PayPal offers no API to void an
 * unapproved order — it simply expires unused — so the row is rejected
 * and capturePurchase refuses it from then on.
 */
export async function cancelPurchase(id: number): Promise<PurchaseRequest> {
  const purchase = await getPurchase(id);
  if (!purchase) throw new Error(`purchase ${id} not found`);
  if (purchase.status !== "WAITING" || !purchase.paypalOrderId) {
    throw new Error(`purchase ${id} has no open checkout to cancel`);
  }
  return updatePurchase(id, {
    status: "REJECTED",
    decidedBy: "owner",
    errorMessage: "checkout cancelled by owner",
  });
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
  if (purchase.status !== "WAITING") {
    throw new Error(`purchase ${id} is not awaiting payment`);
  }

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
    // row WAITING so the capture can be retried.
    if (message.includes("ORDER_NOT_APPROVED")) throw err;
    // A dead order (sandbox orders expire/get collected) isn't a failure —
    // it resolves as rejected: "the checkout lapsed", same as a no.
    if (/INVALID_RESOURCE_ID|RESOURCE_NOT_FOUND/.test(message)) {
      return updatePurchase(id, {
        status: "REJECTED",
        errorMessage: "checkout expired on PayPal",
      });
    }
    await updatePurchase(id, { status: "FAILED", errorMessage: message });
    throw err;
  }
}

/**
 * Sweep open checkouts against PayPal: capture orders the buyer already
 * approved (even if the return redirect never reached us) and reject ones
 * the sandbox has expired. Best-effort — one bad row never breaks the sweep.
 * This is what lets "approved in the PayPal window" complete on its own.
 */
export async function reconcileWaiting(): Promise<PurchaseRequest[]> {
  const rows = await query<{ id: number; paypal_order_id: string }>(
    "SELECT id, paypal_order_id FROM purchase_requests WHERE status = 'WAITING' AND paypal_order_id IS NOT NULL"
  );
  const resolved: PurchaseRequest[] = [];
  for (const { id, paypal_order_id: orderId } of rows) {
    try {
      if (orderId.startsWith("STUB-ORDER-")) continue;
      const status = await getOrderStatus(orderId);
      if (status === null) {
        resolved.push(
          await updatePurchase(id, {
            status: "REJECTED",
            errorMessage: "checkout expired on PayPal",
          })
        );
      } else if (status === "APPROVED") {
        resolved.push(await capturePurchase(id));
      }
      // CREATED / PAYER_ACTION_REQUIRED / VOIDED: genuinely still waiting
      // (or already void — owner action, leave the row as it is).
    } catch (err) {
      console.error(`[reconcile] purchase ${id}:`, err);
    }
  }
  return resolved;
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
