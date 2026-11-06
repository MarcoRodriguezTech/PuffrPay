import "dotenv/config";
import { Pool } from "pg";
import { searchProducts } from "../src/lib/channel3";

// Channel3 gives each demo row a real catalog photo for the Recent activity
// thumbnails; a failed lookup just leaves the letter-tile fallback.
async function imageFor(title: string): Promise<string | null> {
  try {
    const hits = await searchProducts(title, null);
    return hits.find((p) => p.imageUrl)?.imageUrl ?? null;
  } catch {
    return null;
  }
}

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

  // SEED_RESET=1 (or `tsx scripts/seed.ts --reset`) wipes demo rows first.
  if (process.env.SEED_RESET === "1" || process.argv.includes("--reset")) {
    await pool.query("DELETE FROM purchase_requests");
    await pool.query("DELETE FROM policies");
    await pool.query("DELETE FROM chat_messages");
    console.log("cleared existing rows (reset)");
  }

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
    // Demo seed data: purchased rows total exactly $172 to match the gauge.
    // Realistic products + categories so Activity charts and the grid look real.
    const samples = [
      {
        title: "Japanese snack box assortment (24 pcs)",
        merchant: "https://snack-shop.test/p/japanese-snack-box",
        category: "snacks",
        cents: 18_00,
        decision: "ALLOW",
        reason: "under auto approve limit",
        status: "PURCHASED",
        decidedBy: "policy",
        reasoning: "Matches the request; well under the $20 auto-approve limit.",
        orderId: "SEED-ORDER-1",
        captureId: "SEED-CAPTURE-1",
      },
      {
        title: "Chalk bag + bouldering brush set",
        merchant: "https://crag-gear.test/p/chalk-bag-set",
        category: "climbing",
        cents: 34_00,
        decision: "ASK",
        reason: "needs owner approval",
        status: "WAITING",
        decidedBy: "policy",
        reasoning: "Top-rated pick under $50. Over the auto-approve limit, so needs your approval.",
        orderId: null,
        captureId: null,
      },
      {
        title: "Wireless noise-cancelling earbuds",
        merchant: "https://volt-store.test/p/anc-earbuds",
        category: "electronics",
        cents: 82_00,
        decision: "BLOCK",
        reason: "over per purchase max",
        status: "BLOCKED",
        decidedBy: "policy",
        reasoning: "Best match for the request, but it exceeds the $50 per-purchase maximum.",
        orderId: null,
        captureId: null,
      },
      {
        title: "Insulated trail water bottle, 1L",
        merchant: "https://crag-gear.test/p/trail-bottle-1l",
        category: "outdoor",
        cents: 45_00,
        decision: "ASK",
        reason: "needs owner approval",
        status: "PURCHASED",
        decidedBy: "owner",
        reasoning: "Durable pick that fits the request; you approved it.",
        orderId: "SEED-ORDER-2",
        captureId: "SEED-CAPTURE-2",
      },
      {
        title: "National parks annual pass",
        merchant: "https://park-pass.test/p/annual-pass",
        category: "outdoor",
        cents: 60_00,
        decision: "BLOCK",
        reason: "would exceed monthly cap",
        status: "BLOCKED",
        decidedBy: "policy",
        reasoning: "Buying this would push the month over the $200 cap.",
        orderId: null,
        captureId: null,
      },
      {
        title: "Cast iron mini skillet, 6-inch",
        merchant: "https://kitchen-row.test/p/mini-skillet",
        category: "kitchen",
        cents: 39_00,
        decision: "ASK",
        reason: "needs owner approval",
        status: "PURCHASED",
        decidedBy: "owner",
        reasoning: "Well-reviewed pick in the middle of the budget; you approved it.",
        orderId: "SEED-ORDER-3",
        captureId: "SEED-CAPTURE-3",
      },
      {
        title: "Paperback sci-fi trilogy box set",
        merchant: "https://page-corner.test/p/sci-fi-trilogy",
        category: "books",
        cents: 40_00,
        decision: "ASK",
        reason: "needs owner approval",
        status: "PURCHASED",
        decidedBy: "owner",
        reasoning: "Exactly what was asked for, under the per-purchase max; you approved it.",
        orderId: "SEED-ORDER-4",
        captureId: "SEED-CAPTURE-4",
      },
      {
        title: "Hangboard training grips",
        merchant: "https://crag-gear.test/p/hangboard-grips",
        category: "climbing",
        cents: 30_00,
        decision: "ASK",
        reason: "needs owner approval",
        status: "PURCHASED",
        decidedBy: "owner",
        reasoning: "Solid mid-range option over the auto-approve limit; you approved it.",
        orderId: "SEED-ORDER-5",
        captureId: "SEED-CAPTURE-5",
      },
      {
        title: "Retro arcade joystick controller",
        merchant: "https://retro-games.test/p/arcade-joystick",
        category: "games",
        cents: 42_00,
        decision: "ASK",
        reason: "needs owner approval",
        status: "REJECTED",
        decidedBy: "owner",
        reasoning: "Over the auto-approve limit, so it asked you — and you said no.",
        orderId: null,
        captureId: null,
      },
    ];

    // spread the seeded rows over the past ~2 days (by hours) so they all stay
    // inside the current month and "this week"/"this month" queries hit them
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const imageUrl = await imageFor(s.title);
      await pool.query(
        `INSERT INTO purchase_requests
          (created_at, product_id, product_title, merchant_url, image_url, category, amount_cents,
           agent_reasoning, policy_decision, policy_reason, status, decided_by,
           paypal_order_id, paypal_capture_id)
         VALUES (now() - ($1 || ' hours')::interval, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          String(i * 7),
          `seed-${i + 1}`,
          s.title,
          s.merchant,
          imageUrl,
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
