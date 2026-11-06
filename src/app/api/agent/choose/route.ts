import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
import { chooseOption } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      messageId?: number;
      productId?: string;
    };
    const messageId = Math.round(Number(body.messageId));
    const productId = String(body.productId ?? "");
    if (!Number.isFinite(messageId) || messageId <= 0 || !productId) {
      return NextResponse.json(
        { error: "messageId and productId are required" },
        { status: 400 }
      );
    }
    const result = await chooseOption(messageId, productId);
    return NextResponse.json(result);
  } catch (err) {
    return friendlyError(err, "agent-choose");
  }
}
