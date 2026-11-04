import { NextResponse } from "next/server";
import { getPolicy, updatePolicy } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getPolicy());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const monthlyCapCents = Math.round(Number(b.monthlyCapCents));
    const perPurchaseMaxCents = Math.round(Number(b.perPurchaseMaxCents));
    const autoApproveUnderCents = Math.round(Number(b.autoApproveUnderCents));
    const blockedCategories = Array.isArray(b.blockedCategories)
      ? b.blockedCategories.map((c) => String(c).trim()).filter(Boolean)
      : [];

    const nums: [string, number][] = [
      ["monthlyCapCents", monthlyCapCents],
      ["perPurchaseMaxCents", perPurchaseMaxCents],
      ["autoApproveUnderCents", autoApproveUnderCents],
    ];
    for (const [name, v] of nums) {
      if (!Number.isFinite(v) || v < 0) {
        return NextResponse.json(
          { error: `${name} must be a non-negative number of cents` },
          { status: 400 }
        );
      }
    }

    const policy = await updatePolicy({
      monthlyCapCents,
      perPurchaseMaxCents,
      autoApproveUnderCents,
      blockedCategories,
    });
    return NextResponse.json(policy);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
