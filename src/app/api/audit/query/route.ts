import { NextResponse } from "next/server";
import { questionToSpec } from "@/lib/audit-query";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { question?: string };
    const question = (body.question ?? "").trim();
    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }
    const spec = await questionToSpec(question);
    return NextResponse.json(spec);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Couldn't understand that question (${msg.slice(0, 120)})` },
      { status: 422 }
    );
  }
}
