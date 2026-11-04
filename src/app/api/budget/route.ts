import { NextResponse } from "next/server";
import { getBudget } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getBudget());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
