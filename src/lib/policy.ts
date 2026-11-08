import type { Policy, PolicyDecision } from "./types";

export interface PolicyInput {
  amountCents: number;
  category: string | null;
  title?: string | null;
}

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

/**
 * Word set for blocked-category matching: lowercase, split on non-alphanumerics,
 * 3+ chars, trailing -s/-es stripped so singular and plural line up.
 * Catalog taxonomies ("Gaming Headsets") never equal owner vocabulary
 * ("headsets") exactly — matching is word-level, against category AND title.
 */
function wordsOf(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.replace(/(?:es|s)$/, ""))
  );
}

export function matchesBlocked(
  blockedCategories: string[],
  input: { category: string | null; title?: string | null }
): boolean {
  if (blockedCategories.length === 0) return false;
  const have = new Set([
    ...wordsOf(input.category ?? ""),
    ...wordsOf(input.title ?? ""),
  ]);
  return blockedCategories.some((b) =>
    [...wordsOf(b)].some((w) => have.has(w))
  );
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
  const { amountCents, category, title } = input;

  if (matchesBlocked(policy.blockedCategories, { category, title })) {
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
