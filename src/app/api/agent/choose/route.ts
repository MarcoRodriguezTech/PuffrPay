import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
import { chooseOption, updateOptions } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      messageId?: number;
      productId?: string;
      dismiss?: boolean;
      remove?: string;
    };
    const messageId = Math.round(Number(body.messageId));
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return NextResponse.json(
        { error: "messageId is required" },
        { status: 400 }
      );
    }
    // Non-pick edits: bail out of picking, or drop a single card.
    if (body.dismiss || body.remove) {
      const payload = await updateOptions(messageId, {
        dismiss: !!body.dismiss,
        removeId: body.remove || undefined,
      });
      if (!payload) {
        return NextResponse.json(
          { error: "Those options expired — ask me again." },
          { status: 404 }
        );
      }
      return NextResponse.json({ payload });
    }
    const productId = String(body.productId ?? "");
    if (!productId) {
      return NextResponse.json(
        { error: "productId is required" },
        { status: 400 }
      );
    }
    const result = await chooseOption(messageId, productId);
    return NextResponse.json(result);
  } catch (err) {
    return friendlyError(err, "agent-choose");
  }
}
