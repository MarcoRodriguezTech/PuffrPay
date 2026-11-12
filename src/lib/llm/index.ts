import type { LLM } from "./types";
import { MockLLM } from "./mock";
import { GeminiLLM } from "./gemini";

let instance: LLM | null = null;

// Errors worth a retry: rate spikes (429/503/high demand), quota, and plain
// network blips. Anything else (auth, bad request, schema) fails immediately.
const TRANSIENT =
  /429|503|rate|quota|resource_exhausted|too many|high demand|overloaded|unavailable|busy|deadline|timed?\s?out|ECONNRESET|ETIMEDOUT/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Internal — exported for retry.test.ts. */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= 2 || !TRANSIENT.test(msg)) throw err;
      const wait = 700 * (attempt + 1) + Math.floor(Math.random() * 300);
      console.warn(
        `[llm] ${label} transient failure — retry ${attempt + 2}/3 in ${wait}ms:`,
        msg.slice(0, 140)
      );
      await sleep(wait);
    }
  }
}

/* Every real-provider method retries transient failures twice (≈0.7s/2s +
   jitter) before throwing — Google's demand spikes usually clear inside one
   retry, so the chat/Ask surfaces stay quiet instead of showing a snag. The
   mock provider skips it so tests keep exact call counts. */
function withRetry(llm: LLM): LLM {
  return {
    name: llm.name,
    planSearch: (m) => callWithRetry(() => llm.planSearch(m), "planSearch"),
    pickProduct: (m, p) => callWithRetry(() => llm.pickProduct(m, p), "pickProduct"),
    pickProducts: (m, p, n) =>
      callWithRetry(() => llm.pickProducts(m, p, n), "pickProducts"),
    auditQuery: (q) => callWithRetry(() => llm.auditQuery(q), "auditQuery"),
  };
}

/**
 * Single entry point for all LLM calls. Provider chosen by LLM_PROVIDER:
 *   mock   -> canned deterministic responses (default; tests + dev)
 *   gemma  -> Google GenAI, Gemma model from GEMINI_MODEL
 *   gemini -> Google GenAI, Gemini model from GEMINI_MODEL
 */
export function getLLM(): LLM {
  if (instance) return instance;
  const provider = (process.env.LLM_PROVIDER || "mock").toLowerCase();
  instance =
    provider === "gemma" || provider === "gemini"
      ? withRetry(new GeminiLLM())
      : new MockLLM();
  return instance;
}

export type { LLM } from "./types";
