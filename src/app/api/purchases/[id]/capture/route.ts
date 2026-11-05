import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
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
    return friendlyError(err, "capture");
  }
}
