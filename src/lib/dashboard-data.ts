import { getPolicy, listPurchases } from "./repo";
import type { Policy, PurchaseRequest } from "./types";

// Flat rows for the dashboard's AG Studio data sources. Sources:
//   requests      purchase_requests rows (Postgres), with derived measure columns
//   policy        the single policies row (Postgres)
// Date fields also bind to a shared calendar so widgets can group by month/week/day.

function requestRows(purchases: PurchaseRequest[], policy: Policy) {
  // Running total of purchased spend in time order, for the cumulative
  // spend-vs-cap chart (blocked/waiting/rejected rows carry the total forward).
  const running = new Map<number, number>();
  let total = 0;
  for (const p of [...purchases].sort(
    (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)
  )) {
    if (p.status === "PURCHASED") total += p.amountCents;
    running.set(p.id, total);
  }
  return purchases.map((p) => {
    const amount = p.amountCents / 100;
    const purchased = p.status === "PURCHASED";
    return {
      ref: String(p.id),
      createdAt: p.createdAt,
      title: p.productTitle,
      merchantUrl: p.merchantUrl,
      imageUrl: p.imageUrl,
      category: p.category ?? "Uncategorised",
      amount,
      currency: p.currency,
      decision: p.policyDecision,
      status: p.status,
      decidedBy: p.decidedBy,
      reason: p.policyReason,
      reasoning: p.agentReasoning,
      orderId: p.paypalOrderId,
      isStub:
        (p.paypalOrderId?.startsWith("STUB-") ?? false) ||
        (p.paypalCaptureId?.startsWith("STUB-") ?? false),
      // Numeric 1/0 and status-conditional amounts so Studio measures can sum them.
      spent: purchased ? amount : 0,
      cumulative: (running.get(p.id) ?? 0) / 100,
      purchased: purchased ? 1 : 0,
      blocked: p.status === "BLOCKED" ? 1 : 0,
      waiting: p.status === "WAITING" ? 1 : 0,
      autoApproved: purchased && p.decidedBy === "policy" ? 1 : 0,
      // Policy limits denormalised onto each row so expressions can compare
      // spend to cap without a cross-table join (avg of a constant = the cap).
      monthlyCap: policy.monthlyCapCents / 100,
      perPurchaseMax: policy.perPurchaseMaxCents / 100,
      autoApproveUnder: policy.autoApproveUnderCents / 100,
      // FilterableRow aliases so the Ask box's client-side filtering (which
      // speaks in cents/title field names) works on the same rows.
      productTitle: p.productTitle,
      amountCents: p.amountCents,
      policyReason: p.policyReason,
      agentReasoning: p.agentReasoning,
    };
  });
}

function policyRow(policy: Policy) {
  return [
    {
      monthlyCap: policy.monthlyCapCents / 100,
      perPurchaseMax: policy.perPurchaseMaxCents / 100,
      autoApproveUnder: policy.autoApproveUnderCents / 100,
      blockedCategories: policy.blockedCategories.join(", ") || "None",
      updatedAt: policy.updatedAt,
    },
  ];
}

export async function getDashboardData(asOf = new Date()) {
  const [policy, purchases] = await Promise.all([getPolicy(), listPurchases()]);

  return {
    asOf: asOf.toISOString(),
    requests: requestRows(purchases, policy),
    policy: policyRow(policy),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
