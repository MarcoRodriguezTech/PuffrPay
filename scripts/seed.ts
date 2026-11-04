import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = new Pool({
    connectionString,
    ssl:
      connectionString.includes("localhost") ||
      connectionString.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
  });

  // One demo user policy: cap $200, per-purchase max $50, auto-approve under $20
  const existing = await pool.query("SELECT id FROM policies LIMIT 1");
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO policies (monthly_cap_cents, per_purchase_max_cents, auto_approve_under_cents, blocked_categories)
       VALUES ($1, $2, $3, $4)`,
      [200_00, 50_00, 20_00, ["gift cards", "weapons"]]
    );
    console.log("seeded policy");
  } else {
    console.log("policy already exists, skipping");
  }

  // A handful of sample purchase requests for demos and screenshots
  const count = await pool.query("SELECT count(*)::int AS n FROM purchase_requests");
  if (count.rows[0].n === 0) {
    const samples = [
      {
        title: "Trail Mix Energy Bars (12 pack)",
        merchant: "https://example-shop.test/p/trail-mix",
        category: "snacks",
        cents: 18_00,
        decision: "ALLOW",
        reason: "under auto approve limit",
        status: "PURCHASED",
        decidedBy: "policy",
        reasoning: "Matches request for snacks; well under the $20 auto-approve limit.",
        orderId: "SEED-ORDER-1",
        captureId: "SEED-CAPTURE-1",
      },
      {
        title: "Chalk Bag — Climbing",
        merchant: "https://example-outdoor.test/p/chalk-bag",
        category: "climbing",
        cents: 34_00,
        decision: "ASK",
        reason: "needs owner approval",
        status: "WAITING",
        decidedBy: "policy",
        reasoning: "Top-rated climbing gift under $50. Over the auto-approve limit, so needs your approval.",
        orderId: null,
        captureId: null,
      },
      {
        title: "Noise-Canceling Headphones",
        merchant: "https://example-electronics.test/p/headphones",
        category: "electronics",
        cents: 82_00,
        decision: "BLOCK",
        reason: "over per purchase max",
        status: "BLOCKED",
        decidedBy: "policy",
        reasoning: "Requested headphones exceed the $50 per-purchase maximum.",
        orderId: null,
        captureId: null,
      },
      {
        title: "Insulated Water Bottle 1L",
        merchant: "https://example-outdoor.test/p/bottle",
        category: "outdoor",
        cents: 45_00,
        decision: "ASK",
        reason: "needs owner approval",
        status: "PURCHASED",
        decidedBy: "owner",
        reasoning: "Durable bottle fits the outdoor gear request; owner approved it.",
        orderId: "SEED-ORDER-2",
        captureId: "SEED-CAPTURE-2",
      },
      {
        title: "$60 Game Store Gift Card",
        merchant: "https://example-cards.test/p/giftcard",
        category: "gift cards",
        cents: 60_00,
        decision: "BLOCK",
        reason: "blocked category",
        status: "BLOCKED",
        decidedBy: "policy",
        reasoning: "Gift cards are on the blocked categories list.",
        orderId: null,
        captureId: null,
      },
    ];

    // spread the seeded rows across the past 5 days so "this week" queries work
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      await pool.query(
        `INSERT INTO purchase_requests
          (created_at, product_id, product_title, merchant_url, category, amount_cents,
           agent_reasoning, policy_decision, policy_reason, status, decided_by,
           paypal_order_id, paypal_capture_id)
         VALUES (now() - ($1 || ' days')::interval, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          String(i + 1),
          `seed-${i + 1}`,
          s.title,
          s.merchant,
          s.category,
          s.cents,
          s.reasoning,
          s.decision,
          s.reason,
          s.status,
          s.decidedBy,
          s.orderId,
          s.captureId,
        ]
      );
    }
    console.log(`seeded ${samples.length} purchase requests`);
  } else {
    console.log("purchase_requests not empty, skipping");
  }

  await pool.end();
  console.log("seed done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
