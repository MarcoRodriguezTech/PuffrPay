import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
import { approveAndExecute } from "@/lib/executor";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const result = await approveAndExecute(Number(id));
    return NextResponse.json(result);
  } catch (err) {
    return friendlyError(err, "approve");
  }
}
