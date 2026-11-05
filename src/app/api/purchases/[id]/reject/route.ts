import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
import { rejectPurchase } from "@/lib/executor";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const purchase = await rejectPurchase(Number(id));
    return NextResponse.json({ purchase });
  } catch (err) {
    return friendlyError(err, "reject");
  }
}
