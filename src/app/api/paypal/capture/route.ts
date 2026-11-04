import { NextResponse } from "next/server";
import { capturePurchase, getPurchaseByOrderId } from "@/lib/executor";

export const dynamic = "force-dynamic";

/** Capture by PayPal order id — used by the /paypal/return landing page. */
export async function POST(req: Request) {
  try {
    const { orderId } = (await req.json()) as { orderId?: string };
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }
    const purchase = await getPurchaseByOrderId(orderId);
    if (!purchase) {
      return NextResponse.json(
        { error: `no purchase found for order ${orderId}` },
        { status: 404 }
      );
    }
    const updated = await capturePurchase(purchase.id);
    return NextResponse.json({ purchase: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
