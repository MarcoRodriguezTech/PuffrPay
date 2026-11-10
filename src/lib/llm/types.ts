import type { ProductResult } from "../types";

/** What the agent's first call returns: a search plan for Channel3. */
export interface SearchPlan {
  /** null when the message isn't searchable — "reply" is said to the owner
      instead (clarifying question for vague shopping asks, persona answer
      for chit-chat). */
  query: string | null;
  maxPriceCents: number;
  /** What the agent says when query is null. Missing means use the canned
      persona fallback. */
  reply?: string | null;
}

/** What the agent's second call returns: the chosen product + reasoning. */
export interface PickResult {
  productId: string;
  reasoning: string;
}

/** One suggestion from the multi-pick call: product + a short vibe tag. */
export interface OptionPick {
  productId: string;
  /** 1-3 word vibe, e.g. "playful pick", "practical pick". */
  tag: string;
  reasoning: string;
}

/** One filter clause produced by the audit-query call. */
export interface AuditFilter {
  field: string;
  operator: string;
  value: string;
}

/** JSON schema the audit-query LLM call must produce. */
export interface AuditQuerySpec {
  filters: AuditFilter[];
  sort: { field: string; direction: "asc" | "desc" } | null;
  summary: { type: "count" | "sum"; field?: string } | null;
}

/**
 * All LLM access goes through this interface. The mock provider is the
 * default for tests and development so no real calls are needed.
 */
export interface LLM {
  readonly name: string;
  /** Turn an owner message into a Channel3 search plan (JSON only). */
  planSearch(message: string): Promise<SearchPlan>;
  /** Pick one product from search results and explain why (JSON only). */
  pickProduct(
    message: string,
    products: ProductResult[]
  ): Promise<PickResult | null>;
  /**
   * Curate up to maxPicks varied products for the owner to choose between.
   * Returns [] when nothing fits (JSON only).
   */
  pickProducts(
    message: string,
    products: ProductResult[],
    maxPicks: number
  ): Promise<OptionPick[]>;
  /** Turn a natural-language audit question into validated filter JSON. */
  auditQuery(question: string): Promise<AuditQuerySpec>;
}
