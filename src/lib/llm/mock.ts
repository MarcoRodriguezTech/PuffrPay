import type { ProductResult } from "../types";
import type { AuditQuerySpec, LLM, OptionPick, PickResult, SearchPlan } from "./types";

function dollarsToCents(s: string): number | null {
  const m = s.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!m) return null;
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
}

/**
 * Deterministic canned provider — the default for tests and development.
 * It parses the owner message for "$N" budgets and keywords, picks the
 * cheapest plausible product, and returns canned audit filters.
 */
export class MockLLM implements LLM {
  readonly name = "mock";

  async planSearch(message: string): Promise<SearchPlan> {
    // Mirror the real provider's intent gate: greeting/question openers with
    // no shopping verbs are chat, not a purchase request. Conservative —
    // borderline messages still search rather than going silent.
    const m = message.trim().toLowerCase();
    const chatty =
      /^(hi|hello|hey|yo|sup|help|what'?s?|what|who|why|how|thanks?|bye|ok|okay)\b/.test(
        m
      );
    const shopping =
      /\b(buy|find|get|order|search|shop|gift|need|want|look(ing)? for)\b/.test(
        m
      );
    if (chatty && !shopping) return { query: null, maxPriceCents: 0 };

    const budget = dollarsToCents(message) ?? 50_00;
    // strip budget phrasing to leave a usable search term
    const query = message
      .replace(/under|less than|below|within|budget|max(imum)?|up to/gi, "")
      .replace(/\$\s*[\d,]+(\.\d{1,2})?/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return { query: query || "gift", maxPriceCents: budget };
  }

  async pickProduct(
    _message: string,
    products: ProductResult[]
  ): Promise<PickResult | null> {
    if (products.length === 0) return null;
    const cheapest = [...products].sort((a, b) => a.priceCents - b.priceCents)[0];
    return {
      productId: cheapest.id,
      reasoning: `[mock] "${cheapest.title}" fits the request and is the cheapest match within budget.`,
    };
  }

  async pickProducts(
    _message: string,
    products: ProductResult[],
    maxPicks: number
  ): Promise<OptionPick[]> {
    const tags = ["Cheapest", "Solid pick", "Wildcard", "Splurge", "Dark horse"];
    return [...products]
      .sort((a, b) => a.priceCents - b.priceCents)
      .slice(0, maxPicks)
      .map((p, i) => ({
        productId: p.id,
        tag: tags[i % tags.length],
        reasoning: `[mock] "${p.title}" fits the request within budget.`,
      }));
  }

  async auditQuery(question: string): Promise<AuditQuerySpec> {
    const q = question.toLowerCase();
    const spec: AuditQuerySpec = { filters: [], sort: null, summary: null };

    if (q.includes("block")) {
      spec.filters.push({ field: "status", operator: "eq", value: "BLOCKED" });
    } else if (q.includes("wait")) {
      spec.filters.push({ field: "status", operator: "eq", value: "WAITING" });
    } else if (q.includes("reject")) {
      spec.filters.push({ field: "status", operator: "eq", value: "REJECTED" });
    } else if (
      q.includes("bought") ||
      q.includes("purchased") ||
      q.includes("spent")
    ) {
      spec.filters.push({ field: "status", operator: "eq", value: "PURCHASED" });
    }

    if (q.includes("this week")) {
      spec.filters.push({ field: "created_at", operator: "gte", value: "week" });
    } else if (q.includes("this month") || q.includes("month")) {
      spec.filters.push({ field: "created_at", operator: "gte", value: "month" });
    }

    if (q.includes("total") || q.includes("how much") || q.includes("sum")) {
      spec.summary = { type: "sum", field: "amount_cents" };
    } else if (q.includes("how many") || q.includes("count")) {
      spec.summary = { type: "count" };
    }

    spec.sort = { field: "created_at", direction: "desc" };
    return spec;
  }
}
