import { NextResponse } from "next/server";
import { capturePurchase } from "@/lib/executor";

export const dynamic = "force-dynamic";

/** Called by the UI after the buyer approves in the PayPal sandbox window. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const purchase = await capturePurchase(Number(id));
    return NextResponse.json({ purchase });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /not found/.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
