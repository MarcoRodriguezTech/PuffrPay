// POST /api/chat — one LLM turn for the AG Studio AI panel.
//
// The Studio client adapter (activity/studio/ai-adapter.ts) sends an
// AgLlmRequest; we run it against Gemini server-side (keys never reach the
// browser) and stream back NDJSON lines:
//   {"e": AgAiEvent}      content events for the run (text/tool chunks)
//   {"done": AgLlmResponse}  the consolidated turn result — always the last line
//   {"err": {code,message}}  replaces everything above on failure
// Only friendly messages cross the wire: real provider errors are logged here.

import { GoogleGenAI } from "@google/genai";
import type {
  AgAiConversationItem,
  AgAiOutputItem,
  AgAiToolSchema,
  AgLlmRequest,
} from "ag-studio";

export const dynamic = "force-dynamic";

type Part =
  | { text: string }
  | {
      functionCall: { name: string; args: Record<string, unknown> };
      thoughtSignature?: string;
    }
  | { functionResponse: { name: string; response: { result: string } } };

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" && (c as { text?: string }).text) || "")
    .join("");
}

// AgAiConversationItem[] -> Gemini contents[]. Tool results reference calls by
// id, so remember callId -> name while walking the items.
function toContents(items: AgAiConversationItem[]): {
  contents: { role: "user" | "model"; parts: Part[] }[];
  system: string[];
} {
  const contents: { role: "user" | "model"; parts: Part[] }[] = [];
  const system: string[] = [];
  const callNames = new Map<string, string>();
  // Gemini 3.x requires the model's own thought_signature echoed back on
  // replayed functionCall parts. Items that lack one (older history, other
  // adapters) are described as text instead — a bare functionCall 400s.
  // callIds can repeat across sub-turns, so track the latest call per id.
  const callSigned = new Map<string, boolean>();
  for (const item of items) {
    const it = item as unknown as Record<string, unknown> & {
      type?: string;
      role?: string;
    };
    if (it.type === "message" && it.role === "system") {
      system.push(textOf(it.content));
    } else if (it.type === "message" && it.role === "user") {
      contents.push({ role: "user", parts: [{ text: textOf(it.content) }] });
    } else if (it.type === "message" && it.role === "assistant") {
      contents.push({ role: "model", parts: [{ text: textOf(it.content) }] });
    } else if (it.type === "function_call") {
      const name = String(it.name ?? "");
      const callId = String(it.callId ?? it.id ?? name);
      callNames.set(callId, name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(String(it.arguments ?? "{}"));
      } catch {
        /* partial args — send empty */
      }
      const sig =
        typeof it.thoughtSignature === "string" ? it.thoughtSignature : undefined;
      callSigned.set(callId, !!sig);
      if (sig) {
        contents.push({
          role: "model",
          parts: [{ functionCall: { name, args }, thoughtSignature: sig }],
        });
      } else {
        contents.push({
          role: "model",
          parts: [{ text: `[Called tool ${name} with ${JSON.stringify(args)}]` }],
        });
      }
    } else if (it.type === "function_call_output") {
      const name = callNames.get(String(it.callId)) ?? "tool";
      const output = String(it.output ?? "");
      if (callSigned.get(String(it.callId))) {
        contents.push({
          role: "user",
          parts: [
            { functionResponse: { name, response: { result: output } } },
          ],
        });
      } else {
        contents.push({
          role: "user",
          parts: [{ text: `[Tool ${name} returned: ${output}]` }],
        });
      }
    }
    // reasoning items: not sent back to the model.
  }
  return { contents, system };
}

function toToolConfig(request: AgLlmRequest) {
  const tools = (request.tools ?? []) as AgAiToolSchema[];
  const declarations = tools
    .filter((t) => t.kind !== "provided")
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    }));
  const config: Record<string, unknown> = {};
  if (declarations.length) config.tools = [{ functionDeclarations: declarations }];
  const choice = request.toolChoice;
  if (choice === "none") {
    config.toolConfig = { functionCallingConfig: { mode: "NONE" } };
  } else if (choice === "required") {
    config.toolConfig = { functionCallingConfig: { mode: "ANY" } };
  } else if (typeof choice === "object" && choice?.name) {
    config.toolConfig = {
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.name] },
    };
  }
  if (request.responseFormat?.type === "json") {
    config.responseMimeType = "application/json";
    if (request.responseFormat.schema) {
      config.responseSchema = request.responseFormat.schema;
    }
  }
  return config;
}

const rateLimit = (err: unknown) =>
  /429|rate limit|quota|resource_exhausted/i.test(
    err instanceof Error ? err.message : String(err)
  );

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
        const request = (await req.json()) as AgLlmRequest;
        const { contents, system } = toContents(request.input ?? []);
        const ai = new GoogleGenAI({ apiKey });
        const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

        const config = toToolConfig(request);
        const systemText = [request.instructions, ...system].filter(Boolean).join("\n\n");
        if (systemText) config.systemInstruction = systemText;

        const output: AgAiOutputItem[] = [];
        let textId = 0;
        let callId = 0;
        let textBuf = "";
        const flushText = () => {
          if (!textBuf) return;
          output.push({
            id: `msg-${++textId}`,
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: textBuf }],
            status: "completed",
          } as AgAiOutputItem);
          textBuf = "";
        };

        const res = await ai.models.generateContentStream({
          model,
          contents: contents as never,
          config: config as never,
        });
        for await (const chunk of res) {
          const parts =
            (chunk as { candidates?: { content?: { parts?: Record<string, unknown>[] } }[] })
              .candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (typeof part.text === "string" && part.text) {
              const messageId = `msg-${textId + 1}`;
              send({ e: { type: "TEXT_MESSAGE_CHUNK", messageId, delta: part.text } });
              textBuf += part.text;
            } else if (part.functionCall) {
              flushText();
              const fc = part.functionCall as { name?: string; args?: unknown };
              const sig = (part as { thoughtSignature?: unknown }).thoughtSignature;
              const id = `call-${++callId}`;
              const argStr = JSON.stringify(fc.args ?? {});
              send({
                e: { type: "TOOL_CALL_CHUNK", toolCallId: id, toolCallName: fc.name, delta: argStr },
              });
              output.push({
                id,
                type: "function_call",
                callId: id,
                name: String(fc.name ?? ""),
                arguments: argStr,
                status: "completed",
                ...(typeof sig === "string" ? { thoughtSignature: sig } : {}),
              } as AgAiOutputItem);
            }
          }
        }
        flushText();
        send({
          done: {
            id: `resp-${Date.now()}`,
            createdAt: Date.now(),
            output,
            status: "completed",
          },
        });
      } catch (err) {
        console.error("[/api/chat] LLM turn failed:", err);
        send({
          err: {
            code: rateLimit(err) ? "rate_limited" : "llm_error",
            message: rateLimit(err)
              ? "Puffr is catching its breath. Try again in a minute."
              : "Something went wrong on our side. Try again.",
          },
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
