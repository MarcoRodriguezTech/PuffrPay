import { NextResponse } from "next/server";
import { friendlyError } from "@/lib/api-error";
import { runAgent, getChatHistory } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { message?: string };
    const message = (body.message ?? "").trim();
    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    const result = await runAgent(message);
    return NextResponse.json(result);
  } catch (err) {
    return friendlyError(err, "agent");
  }
}

export async function GET() {
  const messages = await getChatHistory();
  return NextResponse.json({ messages });
}
