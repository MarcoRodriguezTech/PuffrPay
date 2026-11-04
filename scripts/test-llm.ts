import "dotenv/config";

/**
 * Probe the owner's Google AI Studio key: list available models and test a
 * JSON-only generation + a function-calling round trip.
 * Prints model names only — never the key.
 */

const maybeKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
if (!maybeKey) {
  console.log("no GEMINI_API_KEY/LLM_API_KEY in .env — skipping");
  process.exit(0);
}
const key: string = maybeKey;

const base = "https://generativelanguage.googleapis.com/v1beta";

async function main() {
  const res = await fetch(`${base}/models?pageSize=100`, {
    headers: { "x-goog-api-key": key },
  });
  if (!res.ok) {
    console.log(`list models failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const data = (await res.json()) as {
    models: { name: string; supportedGenerationMethods?: string[] }[];
  };
  const usable = data.models
    .filter((m) =>
      m.supportedGenerationMethods?.includes("generateContent")
    )
    .map((m) => m.name.replace("models/", ""));
  console.log("models with generateContent:");
  usable.forEach((m) => console.log("  -", m));

  // JSON-only generation test on a chosen model (arg) or first gemma found
  const cand =
    process.argv[2] ??
    usable.find((m) => m.includes("gemma")) ??
    usable.find((m) => m.includes("flash-lite")) ??
    usable[0];
  if (!cand) {
    console.log("no usable model found");
    return;
  }
  console.log(`\ntesting JSON output on ${cand}...`);
  const gen = await fetch(`${base}/models/${cand}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { role: "user", parts: [{ text: 'Return ONLY JSON {"ok": true}' }] },
      ],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const genText = await gen.text();
  console.log(
    `json gen: ${gen.status}`,
    gen.ok ? genText.slice(0, 220) : genText.slice(0, 300)
  );

  // function calling support test
  console.log(`\ntesting function calling on ${cand}...`);
  const fc = await fetch(`${base}/models/${cand}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: "Search for climbing shoes under $80" }],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: "search_products",
              description: "Search the product catalog",
              parameters: {
                type: "OBJECT",
                properties: {
                  query: { type: "STRING" },
                  max_price: { type: "NUMBER" },
                },
                required: ["query"],
              },
            },
          ],
        },
      ],
    }),
  });
  const fcText = await fc.text();
  const called = fcText.includes("functionCall");
  console.log(`function calling: ${fc.status} -> ${called ? "SUPPORTED (returned a call)" : "no call returned"}`);
  if (!called) console.log("  resp:", fcText.slice(0, 300));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
