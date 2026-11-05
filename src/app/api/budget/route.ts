import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
import { getBudget } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getBudget());
  } catch (err) {
    return friendlyError(err, "budget");
  }
}
