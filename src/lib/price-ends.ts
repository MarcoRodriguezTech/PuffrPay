export type Tagged<T> = T & { tag: string; reasoning: string };

// Reserved tags owned by this post-pass — LLM providers must not emit them
// (enforced for Gemini in its pickProducts prompt; kept out of the mock's
// rotation).
export const TAG_CHEAPEST = "Cheapest";
export const TAG_PRICIEST = "Priciest";

/**
 * Price-bookend guarantee: the cheapest and priciest of the affordable pool
 * are always offered under their reserved tags. Ends already in the hand are
 * retagged in place (keeping the LLM's order and reasoning); missing ends are
 * appended when there's room, else the last non-end card is evicted. When the
 * same product is both extremes (single result or all-equal prices) only the
 * Cheapest tag is applied.
 */
export function ensurePriceEnds<T extends { id: string; priceCents: number }>(
  items: Tagged<T>[],
  affordable: T[],
  want: number
): Tagged<T>[] {
  if (affordable.length === 0) return items;

  const cheapest = affordable.reduce((a, b) =>
    b.priceCents < a.priceCents ? b : a
  );
  const priciest = affordable.reduce((a, b) =>
    b.priceCents > a.priceCents ? b : a
  );

  const ends = [{ p: cheapest, tag: TAG_CHEAPEST }];
  if (priciest.id !== cheapest.id) {
    ends.push({ p: priciest, tag: TAG_PRICIEST });
  }
  const endIds = new Set(ends.map((e) => e.p.id));

  const out = [...items];
  for (const { p, tag } of ends) {
    const idx = out.findIndex((x) => x.id === p.id);
    if (idx >= 0) {
      out[idx] = { ...out[idx], tag };
      continue;
    }
    const item = { ...p, tag, reasoning: reasonFor(tag) };
    if (out.length < want) {
      out.push(item);
      continue;
    }
    // Full hand — evict the last non-end card. (want >= ends.length always:
    // want = min(MAX_OPTIONS, affordable.length) and ends dedupe to 1 when
    // the pool has a single product.)
    let evict = out.length - 1;
    while (evict >= 0 && endIds.has(out[evict].id)) evict--;
    if (evict < 0) break;
    out[evict] = item;
  }
  return out;
}

function reasonFor(tag: string): string {
  return tag === TAG_CHEAPEST
    ? "The cheapest option under your limit."
    : "The priciest option under your limit.";
}
