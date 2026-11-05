import { NextResponse } from "next/server";
import { evaluatePolicy } from "@/lib/policy";
import { getBudget, getPolicy } from "@/lib/repo";
import { friendlyError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

/** Dry-run the policy engine: {amountCents, category} -> {decision, reason}. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { amountCents?: number; category?: string };
    const amountCents = Math.round(Number(body.amountCents));
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json(
        { error: "amountCents must be a positive number of cents" },
        { status: 400 }
      );
    }
    const [policy, budget] = await Promise.all([getPolicy(), getBudget()]);
    const result = evaluatePolicy(
      policy,
      { amountCents, category: body.category?.trim() || null },
      budget.spentCents
    );
    return NextResponse.json(result);
  } catch (err) {
    return friendlyError(err, "policy-simulate");
  }
}
