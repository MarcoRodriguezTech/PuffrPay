import { GoogleGenAI } from "@google/genai";
import type { ProductResult } from "../types";
import type { AuditQuerySpec, LLM, OptionPick, PickResult, SearchPlan } from "./types";

const MAX_ATTEMPTS = 4;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimited(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string };
  return (
    e?.status === 429 ||
    e?.code === 429 ||
    /429|rate limit|quota/i.test(e?.message ?? "")
  );
}

/** Retry with exponential backoff on 429s; rethrows after MAX_ATTEMPTS. */
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimited(err) || attempt === MAX_ATTEMPTS - 1) throw err;
      await sleep(2 ** attempt * 1000);
    }
  }
  throw lastErr;
}

function extractJson(text: string): string {
  // tolerate markdown fences or leading/trailing prose
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  // the root may be an object or an array (pickProducts asks for [{...}]);
  // anchor on whichever bracket opens first and slice to its matching close
  const start = body.search(/[[{]/);
  if (start === -1) {
    throw new Error(`LLM returned non-JSON: ${text.slice(0, 200)}`);
  }
  const closer = body[start] === "{" ? "}" : "]";
  const end = body.lastIndexOf(closer);
  if (end <= start) {
    throw new Error(`LLM returned non-JSON: ${text.slice(0, 200)}`);
  }
  return body.slice(start, end + 1);
}

/**
 * Gemini / Gemma provider via @google/genai. One method per agent call,
 * each requesting JSON-only output. Never used for policy decisions.
 */
export class GeminiLLM implements LLM {
  readonly name = "gemini";
  private ai: GoogleGenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY (or LLM_API_KEY) is not set");
    this.ai = new GoogleGenAI({ apiKey });
    // Tested on the owner's key (scripts/test-llm.ts): gemini-3.5-flash-lite
    // returns clean JSON and supports function calling; gemma-4 models 500 on
    // responseMimeType JSON mode and do not support function calling.
    this.model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  }

  private async generateJson(prompt: string): Promise<string> {
    const res = await withBackoff(() =>
      this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        // no responseMimeType: it 500s on Gemma models, and prompts already
        // demand JSON — extractJson tolerates fences/prose.
      })
    );
    return extractJson(res.text ?? "");
  }

  async planSearch(message: string): Promise<SearchPlan> {
    const raw = await this.generateJson(
      `You are the search planner for a shopping agent. Decide whether the owner's message is a request to buy or find a product.
If it is a shopping request: turn it into a product search query and a budget in cents (USD). Infer maxPriceCents from the message; if none is given, use 5000. Keep the query short (2-6 words), product-focused, no prices or filler words.
If it is NOT a shopping request — greetings, questions about you or this app, chit-chat — return {"query": null, "maxPriceCents": 0}.
Return ONLY JSON: {"query": string|null, "maxPriceCents": number}
Owner request: ${JSON.stringify(message)}`
    );
    const parsed = JSON.parse(raw);
    // explicit null = chat; a missing query field keeps the old
    // message-as-query fallback so malformed replies still search
    const q: unknown = "query" in parsed ? parsed.query : message;
    return {
      query:
        q == null || String(q).trim() === "" || String(q).toLowerCase() === "null"
          ? null
          : String(q).slice(0, 200),
      maxPriceCents: Math.max(0, Math.round(Number(parsed.maxPriceCents) || 5000)),
    };
  }

  async pickProduct(
    message: string,
    products: ProductResult[]
  ): Promise<PickResult | null> {
    if (products.length === 0) return null;
    const list = products
      .map(
        (p) =>
          `id=${p.id} | title=${p.title} | price_cents=${p.priceCents} | category=${p.category ?? "unknown"}`
      )
      .join("\n");
    const raw = await this.generateJson(
      `You are a shopping agent. Pick the single best product for the owner's request from the list. Explain why in one short sentence.
Prefer imperfect fits over returning nothing: if no product is a perfect match, still pick the closest option and say what's off in "reasoning". Return {"productId": null} only when the products are completely unrelated to the request.
Return ONLY JSON: {"productId": string|null, "reasoning": string}
Owner request: ${JSON.stringify(message)}
Products:
${list}`
    );
    const parsed = JSON.parse(raw);
    if (!parsed.productId) return null;
    return {
      productId: String(parsed.productId),
      reasoning: String(parsed.reasoning ?? "").slice(0, 1000),
    };
  }

  async pickProducts(
    message: string,
    products: ProductResult[],
    maxPicks: number
  ): Promise<OptionPick[]> {
    if (products.length === 0 || maxPicks < 1) return [];
    const list = products
      .map(
        (p) =>
          `id=${p.id} | title=${p.title} | price_cents=${p.priceCents} | category=${p.category ?? "unknown"}`
      )
      .join("\n");
    const raw = await this.generateJson(
      `You are a shopping agent curating options for the owner. Pick exactly ${maxPicks} DIFFERENT products from the list that fit the owner's request (fewer only if the list itself has fewer) — vary the angle (e.g. a playful pick, a practical pick, a wildcard) so they feel like genuinely different suggestions, best first.
Give each a "tag" (1-3 words naming its angle) and a one-sentence "reasoning" why it fits.
Prefer imperfect fits over returning nothing: if no product is a perfect match, still pick the closest options and say what's off in "reasoning". Return [] only when the products are completely unrelated to the request.
Return ONLY JSON: [{"productId": string, "tag": string, "reasoning": string}]
Owner request: ${JSON.stringify(message)}
Products:
${list}`
    );
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(products.map((p) => p.id));
    return parsed
      .filter((x) => x && typeof x === "object" && known.has(String(x.productId)))
      .slice(0, maxPicks)
      .map((x) => ({
        productId: String(x.productId),
        tag: String(x.tag ?? "pick").slice(0, 40),
        reasoning: String(x.reasoning ?? "").slice(0, 300),
      }));
  }

  async auditQuery(question: string): Promise<AuditQuerySpec> {
    const raw = await this.generateJson(
      `Convert a question about the purchase audit log into a JSON query spec.
Columns: created_at (timestamp), product_title (text), category (text), amount_cents (integer), currency, status (PURCHASED|WAITING|BLOCKED|REJECTED|FAILED), policy_reason (text), agent_reasoning (text), decided_by (policy|owner).
Allowed operators: eq, neq, gt, gte, lt, lte, contains.
Relative dates use value "week" (this week, since Monday) or "month" (this calendar month) with operator gte on created_at; otherwise ISO dates.
Return ONLY JSON:
{"filters":[{"field":string,"operator":string,"value":string}],
 "sort":{"field":string,"direction":"asc"|"desc"}|null,
 "summary":{"type":"count"|"sum","field":string}|null}
Use summary sum on amount_cents for "total"/"how much" questions, count for "how many". Default sort: created_at desc.
Question: ${JSON.stringify(question)}`
    );
    return JSON.parse(raw) as AuditQuerySpec;
  }
}
