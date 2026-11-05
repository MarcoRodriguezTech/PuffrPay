"use client";

// AgLlmAdapter for the Studio AI panel: a pure transport that POSTs the turn
// to /api/chat and replays the streamed NDJSON events. The Gemini key never
// leaves the server.

import type {
  AgAiEvent,
  AgLlmAdapter,
  AgLlmExecuteTurnOptions,
  AgLlmRequest,
  AgLlmResponse,
} from "ag-studio";

const FAILED: AgLlmResponse = {
  id: "failed",
  createdAt: 0,
  output: [],
  status: "failed",
};

export const studioChatAdapter: AgLlmAdapter = {
  executeTurn(request: AgLlmRequest, options?: AgLlmExecuteTurnOptions) {
    let done!: (r: AgLlmResponse) => void;
    const complete = new Promise<AgLlmResponse>((resolve) => {
      done = resolve;
    });

    async function* stream() {
      let res: Response;
      try {
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: options?.signal ?? null,
        });
      } catch {
        done({ ...FAILED, id: `resp-${Date.now()}`, error: { code: "network", message: "No connection" } });
        return;
      }
      if (!res.ok || !res.body) {
        console.error("[chat] request failed", res.status);
        done({
          ...FAILED,
          id: `resp-${Date.now()}`,
          error: { code: "llm_error", message: "Something went wrong on our side. Try again." },
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done: finished, value } = await reader.read();
          if (finished) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const msg = JSON.parse(line) as {
                e?: AgAiEvent;
                done?: AgLlmResponse;
                err?: { code: string; message: string };
              };
              if (msg.e) yield msg.e;
              else if (msg.done) done(msg.done);
              else if (msg.err) {
                done({
                  ...FAILED,
                  id: `resp-${Date.now()}`,
                  error: msg.err,
                });
              }
            } catch {
              /* partial JSON line — skip */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error("[chat] stream failed", err);
          done({
            ...FAILED,
            id: `resp-${Date.now()}`,
            error: { code: "llm_error", message: "Something went wrong on our side. Try again." },
          });
        }
      } finally {
        done(FAILED); // no-op if already resolved
      }
    }

    return { stream: stream(), complete };
  },
};
