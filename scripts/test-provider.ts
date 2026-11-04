import "dotenv/config";
import { GeminiLLM } from "../src/lib/llm/gemini";

async function main() {
  const llm = new GeminiLLM();
  const plan = await llm.planSearch(
    "find a birthday gift for my sister, she climbs, under $50"
  );
  console.log("plan:", JSON.stringify(plan));

  const pick = await llm.pickProduct("climbing gift under $50", [
    {
      id: "p1",
      title: "Chalk Bag",
      priceCents: 3400,
      currency: "USD",
      merchantUrl: null,
      category: "climbing",
    },
    {
      id: "p2",
      title: "Climbing Shoes",
      priceCents: 4900,
      currency: "USD",
      merchantUrl: null,
      category: "climbing",
    },
  ]);
  console.log("pick:", JSON.stringify(pick));

  const spec = await llm.auditQuery(
    "show everything the agent blocked this week"
  );
  console.log("spec:", JSON.stringify(spec));
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
