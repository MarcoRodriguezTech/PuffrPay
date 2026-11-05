import { NextResponse } from "next/server";
import { questionToSpec } from "@/lib/audit-query";
import { friendlyError } from "@/lib/api-error";

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
    // A question the LLM can't shape into a spec is a friendly 422; anything
    // else (rate limits, DB, network) goes through the sanitized boundary.
    if (/non-JSON|invalid query spec|unknown status|only allowed|invalid spec/i.test(msg)) {
      return NextResponse.json({ error: "unparseable" }, { status: 422 });
    }
    return friendlyError(err, "audit-query");
  }
}
