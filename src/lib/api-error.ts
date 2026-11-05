import { NextResponse } from "next/server";

/**
 * API error boundary: logs the real error server-side and returns only a
 * friendly message to the client — raw provider/DB error text must never
 * reach the UI. Keeps two machine-readable codes the UI maps to friendly
 * copy: rate limiting (busy) and PayPal's ORDER_NOT_APPROVED.
 */
export function friendlyError(err: unknown, context: string): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[${context}]`, err);
  if (/not found/i.test(msg)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (/ORDER_NOT_APPROVED/i.test(msg)) {
    return NextResponse.json({ error: "ORDER_NOT_APPROVED" }, { status: 409 });
  }
  if (/429|rate limit|quota|resource_exhausted|too many/i.test(msg)) {
    return NextResponse.json(
      { error: "The AI is busy (free tier limit). Try again in a minute." },
      { status: 503 }
    );
  }
  return NextResponse.json(
    { error: "Something went wrong on our side. Try again." },
    { status: 500 }
  );
}
