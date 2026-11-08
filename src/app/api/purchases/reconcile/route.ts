import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
import { reconcileWaiting } from "@/lib/executor";

export const dynamic = "force-dynamic";

/**
 * Sweep open checkouts with PayPal: captures orders the buyer approved
 * (even when the return redirect never came back) and rejects dead ones.
 * Called by the queues on load/poll — replaces the manual capture button.
 */
export async function POST() {
  try {
    const resolved = await reconcileWaiting();
    return NextResponse.json({ resolved });
  } catch (err) {
    return friendlyError(err, "reconcile");
  }
}
