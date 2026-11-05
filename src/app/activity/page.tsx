import type { Metadata } from "next";
import { connection } from "next/server";
import { getDashboardData } from "@/lib/dashboard-data";
import { Activity } from "./activity";

export const metadata: Metadata = {
  title: "Activity",
};

// "LLM budget allows": a real provider is configured with a key. The mock
// provider gets the plain Ask box instead of the Studio chat panel.
function chatMode(): "studio" | "ask" {
  const provider = (process.env.LLM_PROVIDER || "mock").toLowerCase();
  const key = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  return (provider === "gemini" || provider === "gemma") && key ? "studio" : "ask";
}

export default async function ActivityPage() {
  // Live data (Postgres): render per request, not at build time.
  await connection();
  try {
    const data = await getDashboardData();
    // Only the licence key reaches the client; PayPal credentials never do.
    return (
      <Activity data={data} licenseKey={process.env.AG_STUDIO} chatMode={chatMode()} />
    );
  } catch (err) {
    // Details stay in the server log; the UI gets a friendly line + fallback.
    console.error("[/activity] failed to load dashboard data:", err);
    return (
      <main className="page">
        <h1>Activity</h1>
        <p className="notice">
          The activity report couldn&apos;t load right now.{" "}
          <a href="/audit/classic">Open the classic log</a> — it reads the same
          data — or check that Postgres is running and seeded (
          <code>npm run db:up && npm run migrate && npm run seed</code>).
        </p>
      </main>
    );
  }
}
