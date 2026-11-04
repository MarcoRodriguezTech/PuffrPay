import { Channel3 } from "@channel3/sdk";
import type { ProductResult } from "./types";

/**
 * Server-side product search through the official Channel3 SDK.
 * Channel3 is a catalog only — it has no checkout. The offer URL is stored
 * on the purchase record; payment always happens through PayPal sandbox.
 *
 * When CHANNEL3_API_KEY is not set, a small built-in catalog is used so the
 * app still runs end to end in development and demos (see README).
 */

let client: Channel3 | null = null;

function getClient(): Channel3 | null {
  if (client) return client;
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) return null;
  client = new Channel3({ apiKey });
  return client;
}

const FALLBACK_CATALOG: ProductResult[] = [
  {
    id: "fb-chalk-bag",
    title: "Chalk Bag — Climbing",
    priceCents: 34_00,
    currency: "USD",
    merchantUrl: "https://example-outdoor.test/p/chalk-bag",
    category: "climbing",
    description: "Basic climbing chalk bag with belt.",
  },
  {
    id: "fb-trail-mix",
    title: "Trail Mix Energy Bars (12 pack)",
    priceCents: 18_00,
    currency: "USD",
    merchantUrl: "https://example-shop.test/p/trail-mix",
    category: "snacks",
    description: "Box of 12 assorted energy bars.",
  },
  {
    id: "fb-headphones",
    title: "Noise-Canceling Headphones",
    priceCents: 82_00,
    currency: "USD",
    merchantUrl: "https://example-electronics.test/p/headphones",
    category: "electronics",
    description: "Over-ear wireless headphones.",
  },
  {
    id: "fb-bottle",
    title: "Insulated Water Bottle 1L",
    priceCents: 45_00,
    currency: "USD",
    merchantUrl: "https://example-outdoor.test/p/bottle",
    category: "outdoor",
    description: "Stainless steel insulated bottle.",
  },
  {
    id: "fb-giftcard",
    title: "$60 Game Store Gift Card",
    priceCents: 60_00,
    currency: "USD",
    merchantUrl: "https://example-cards.test/p/giftcard",
    category: "gift cards",
    description: "Digital gift card.",
  },
];

export async function searchProducts(
  query: string,
  maxPriceCents: number | null
): Promise<ProductResult[]> {
  const c = getClient();
  if (!c) {
    // Dev fallback when no Channel3 key is configured.
    const q = query.toLowerCase();
    return FALLBACK_CATALOG.filter(
      (p) =>
        (maxPriceCents == null || p.priceCents <= maxPriceCents) &&
        (q.split(/\s+/).some(
          (w) =>
            w.length > 2 &&
            (p.title.toLowerCase().includes(w) ||
              (p.category ?? "").toLowerCase().includes(w))
        ) ||
          p.priceCents <= (maxPriceCents ?? Infinity))
    );
  }

  const page = await c.products.search({
    query,
    limit: 15,
    filters:
      maxPriceCents != null
        ? { price: { max_price: maxPriceCents / 100 } }
        : undefined,
    config: { currency: "USD", country: "US" },
  });

  const products: ProductResult[] = [];
  for (const p of page.data) {
    const offer = p.offers?.[0];
    if (!offer?.price?.price) continue;
    products.push({
      id: p.id,
      title: p.title,
      priceCents: Math.round(offer.price.price * 100),
      currency: offer.price.currency ?? "USD",
      merchantUrl: offer.url ?? null,
      category: p.category?.title ?? p.category?.slug ?? null,
      description: p.description,
    });
  }
  return products;
}
