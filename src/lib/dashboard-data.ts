import { getPolicy, listOptionSets, listPurchases } from "./repo";
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
  return purchases.map((p, i) => {
    const amount = p.amountCents / 100;
    const purchased = p.status === "PURCHASED";
    return {
      ref: String(p.id),
      // 1-based rank newest-first — the grid pager widget filters on it.
      rowIdx: i + 1,
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

function optionSetRows(sets: Awaited<ReturnType<typeof listOptionSets>>) {
  // Per-set aggregates of the carousel payloads so the Activity widgets can
  // show what happened *before* a purchase row exists: how many options were
  // auto-ok / needed approval / blocked by rules, and the set's outcome.
  return sets.map((s) => {
    const by = { ALLOW: 0, ASK: 0, BLOCK: 0 } as Record<string, number>;
    const amt = { ALLOW: 0, ASK: 0, BLOCK: 0 } as Record<string, number>;
    let pickedAmt: number | null = null;
    let totalAmt = 0;
    for (const i of s.items) {
      totalAmt += i.priceCents / 100;
      if (s.picked === i.id) {
        // The picked item gets its own bar — keep it out of the decision buckets.
        pickedAmt = i.priceCents / 100;
        continue;
      }
      by[i.decision] = (by[i.decision] ?? 0) + 1;
      amt[i.decision] = (amt[i.decision] ?? 0) + i.priceCents / 100;
    }
    return {
      ref: String(s.id),
      createdAt: s.createdAt,
      options: s.items.length,
      picked: s.picked != null,
      dismissed: s.dismissed,
      open: s.picked == null && !s.dismissed,
      autoOk: by.ALLOW ?? 0,
      needsOk: by.ASK ?? 0,
      blocked: by.BLOCK ?? 0,
      autoAmt: amt.ALLOW ?? 0,
      needsAmt: amt.ASK ?? 0,
      blockedAmt: amt.BLOCK ?? 0,
      totalAmt,
      pickedAmt,
    };
  });
}

export async function getDashboardData(asOf = new Date()) {
  const [policy, purchases, optionSets] = await Promise.all([
    getPolicy(),
    listPurchases(),
    listOptionSets(),
  ]);

  return {
    asOf: asOf.toISOString(),
    requests: requestRows(purchases, policy),
    optionSets: optionSetRows(optionSets),
    policy: policyRow(policy),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
