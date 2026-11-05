import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
import { listPurchases } from "@/lib/repo";
import type { PurchaseStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES = new Set([
  "PURCHASED",
  "WAITING",
  "BLOCKED",
  "REJECTED",
  "FAILED",
]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status")?.toUpperCase();
    const since = url.searchParams.get("since") ?? undefined;
    const purchases = await listPurchases({
      status:
        status && STATUSES.has(status) ? (status as PurchaseStatus) : undefined,
      since,
    });
    return NextResponse.json({ purchases });
  } catch (err) {
    return friendlyError(err, "purchases");
  }
}
