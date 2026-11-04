import type { LLM } from "./types";
import { MockLLM } from "./mock";
import { GeminiLLM } from "./gemini";

let instance: LLM | null = null;

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
      ? new GeminiLLM()
      : new MockLLM();
  return instance;
}

export type { LLM } from "./types";
