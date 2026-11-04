import { NextResponse } from "next/server";
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
    const msg = err instanceof Error ? err.message : String(err);
    const status = /not found/.test(msg) ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
