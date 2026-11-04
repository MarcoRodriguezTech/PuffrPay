import type { Policy, PolicyDecision } from "./types";

export interface PolicyInput {
  amountCents: number;
  category: string | null;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

/**
 * Deterministic policy engine. Pure code — never calls an LLM.
 * Rules run in this exact order; first match wins.
 */
export function evaluatePolicy(
  policy: Pick<
    Policy,
    | "monthlyCapCents"
    | "perPurchaseMaxCents"
    | "autoApproveUnderCents"
    | "blockedCategories"
  >,
  input: PolicyInput,
  monthSpentCents: number
): PolicyResult {
  const { amountCents, category } = input;

  if (
    category != null &&
    policy.blockedCategories
      .map((c) => c.trim().toLowerCase())
      .includes(category.trim().toLowerCase())
  ) {
    return { decision: "BLOCK", reason: "blocked category" };
  }

  if (amountCents > policy.perPurchaseMaxCents) {
    return { decision: "BLOCK", reason: "over per purchase max" };
  }

  if (monthSpentCents + amountCents > policy.monthlyCapCents) {
    return { decision: "BLOCK", reason: "would exceed monthly cap" };
  }

  if (amountCents <= policy.autoApproveUnderCents) {
    return { decision: "ALLOW", reason: "under auto approve limit" };
  }

  return { decision: "ASK", reason: "needs owner approval" };
}
