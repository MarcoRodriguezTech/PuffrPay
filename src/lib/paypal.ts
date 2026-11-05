/**
 * PayPal REST integration — SANDBOX ONLY.
 *
 * Chosen flow (see README "PayPal flow decision"):
 *   1. Server creates an Orders v2 order for the approved purchase.
 *   2. Buyer approves in the PayPal sandbox approval page (link returned).
 *   3. Server captures the order and stores order + capture IDs.
 *
 * PayPal vault / payment-method tokens require vault eligibility that PH
 * sandbox accounts typically do not have, so server-side repeat charging is
 * not available. This is the documented fallback from the project brief.
 */

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";

function baseUrl(): string {
  const env = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
  if (env !== "sandbox") {
    // Hard guard: this app must never touch live PayPal.
    throw new Error(
      `PAYPAL_ENV must be "sandbox" (got "${env}"). Live mode is not supported.`
    );
  }
  return SANDBOX_BASE;
}

function credentials(): { id: string; secret: string } {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
  }
  return { id, secret };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // refresh 60s before expiry
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.token;
  }
  const { id, secret } = credentials();
  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal token request failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cachedToken.token;
}

export interface CreatedOrder {
  orderId: string;
  approveUrl: string | null;
}

/** Absolute URL PayPal returns the buyer to after approval (and on cancel). */
function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export async function createOrder(input: {
  amountCents: number;
  currency: string;
  description: string;
  customId: string;
}): Promise<CreatedOrder> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: input.currency,
            value: (input.amountCents / 100).toFixed(2),
          },
          description: input.description.slice(0, 127),
          custom_id: input.customId,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: "PAY_NOW",
            return_url: `${appBaseUrl()}/paypal/return`,
            cancel_url: `${appBaseUrl()}/`,
          },
        },
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `PayPal create order failed (${res.status}): ${JSON.stringify(json)}`
    );
  }
  // PayPal returns rel "payer-action" when payment_source is specified,
  // "approve" otherwise — accept both.
  const approve = (json.links ?? []).find(
    (l: { rel: string; href: string }) =>
      l.rel === "approve" || l.rel === "payer-action"
  );
  return { orderId: json.id as string, approveUrl: approve?.href ?? null };
}

export interface CaptureResult {
  captureId: string;
  status: string;
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(
    `${baseUrl()}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `PayPal capture failed (${res.status}): ${JSON.stringify(json)}`
    );
  }
  const captureId =
    json.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null;
  return { captureId, status: json.status as string };
}
