import { GoogleGenAI } from "@google/genai";
import type { ProductResult } from "../types";
import type { AuditQuerySpec, LLM, PickResult, SearchPlan } from "./types";

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
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
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
    this.model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  }

  private async generateJson(prompt: string): Promise<string> {
    const res = await withBackoff(() =>
      this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      })
    );
    return extractJson(res.text ?? "");
  }

  async planSearch(message: string): Promise<SearchPlan> {
    const raw = await this.generateJson(
      `You are the search planner for a shopping agent. Turn the owner's request into a product search query and a budget in cents (USD).
Rules: infer maxPriceCents from the message; if none is given, use 5000. Keep the query short (2-6 words), product-focused, no prices or filler words.
Return ONLY JSON: {"query": string, "maxPriceCents": number}
Owner request: ${JSON.stringify(message)}`
    );
    const parsed = JSON.parse(raw);
    return {
      query: String(parsed.query ?? message).slice(0, 200),
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
If nothing fits, return {"productId": null, "reasoning": "why nothing fits"}.
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
