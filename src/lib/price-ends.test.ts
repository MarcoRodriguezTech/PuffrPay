import { describe, it, expect } from "vitest";
import {
  ensurePriceEnds,
  TAG_CHEAPEST,
  TAG_PRICIEST,
} from "./price-ends";

interface FakeProduct {
  id: string;
  priceCents: number;
}

type Item = FakeProduct & { tag: string; reasoning: string };

const p = (id: string, priceCents: number): FakeProduct => ({ id, priceCents });
const item = (id: string, priceCents: number, tag = "pick"): Item => ({
  id,
  priceCents,
  tag,
  reasoning: `r-${id}`,
});

const tags = (items: Item[]) => items.map((x) => x.tag);
const ids = (items: Item[]) => items.map((x) => x.id);

describe("ensurePriceEnds", () => {
  it("retags ends already in the hand, preserving order and reasoning", () => {
    const affordable = [p("a", 10), p("b", 20), p("c", 30), p("d", 40), p("e", 50)];
    // LLM order, priciest first — ends move nowhere.
    const hand = [
      item("e", 50, "Top quality"),
      item("c", 30, "Solid pick"),
      item("a", 10, "Budget option"),
      item("b", 20),
      item("d", 40),
    ];
    const out = ensurePriceEnds(hand, affordable, 5);
    expect(ids(out)).toEqual(["e", "c", "a", "b", "d"]);
    expect(out[0].tag).toBe(TAG_PRICIEST);
    expect(out[2].tag).toBe(TAG_CHEAPEST);
    expect(out[0].reasoning).toBe("r-e"); // LLM reasoning kept
    expect(out.filter((x) => x.tag === TAG_PRICIEST)).toHaveLength(1);
  });

  it("appends missing ends when the hand has room", () => {
    const affordable = [p("a", 10), p("b", 20), p("c", 30), p("d", 40), p("e", 50)];
    const hand = [item("b", 20), item("c", 30), item("d", 40)];
    const out = ensurePriceEnds(hand, affordable, 5);
    expect(out).toHaveLength(5);
    expect(ids(out)).toEqual(["b", "c", "d", "a", "e"]);
    expect(out[3].tag).toBe(TAG_CHEAPEST);
    expect(out[4].tag).toBe(TAG_PRICIEST);
  });

  it("evicts the last non-end cards to include missing ends in a full hand", () => {
    const affordable = [p("a", 10), p("b", 20), p("c", 30), p("d", 40), p("e", 50)];
    const hand = [item("b", 20), item("c", 30), item("d", 40)];
    const out = ensurePriceEnds(hand, affordable, 3);
    expect(out).toHaveLength(3);
    expect(ids(out)).toContain("a");
    expect(ids(out)).toContain("e");
    expect(tags(out)).toContain(TAG_CHEAPEST);
    expect(tags(out)).toContain(TAG_PRICIEST);
  });

  it("never evicts an already-guaranteed end", () => {
    const affordable = [p("a", 10), p("b", 20), p("c", 30)];
    const hand = [item("b", 20), item("c", 30)];
    const out = ensurePriceEnds(hand, affordable, 2);
    // c is retagged Priciest in place; a evicts the only non-end card (b).
    expect(ids(out)).toEqual(["a", "c"]);
    expect(out[0].tag).toBe(TAG_CHEAPEST);
    expect(out[1].tag).toBe(TAG_PRICIEST);
  });

  it("tags only Cheapest for a single-product pool", () => {
    const out = ensurePriceEnds([item("a", 10)], [p("a", 10)], 1);
    expect(out).toHaveLength(1);
    expect(out[0].tag).toBe(TAG_CHEAPEST);
    expect(tags(out)).not.toContain(TAG_PRICIEST);
  });

  it("tags only Cheapest when all prices are equal", () => {
    const affordable = [p("a", 10), p("b", 10), p("c", 10)];
    const hand = [item("a", 10), item("b", 10), item("c", 10)];
    const out = ensurePriceEnds(hand, affordable, 3);
    expect(tags(out).filter((t) => t === TAG_CHEAPEST)).toHaveLength(1);
    expect(tags(out)).not.toContain(TAG_PRICIEST);
  });

  it("guarantees both ends in a two-product pool", () => {
    const affordable = [p("a", 10), p("b", 30)];
    const out = ensurePriceEnds([item("a", 10), item("b", 30)], affordable, 2);
    expect(out[0].tag).toBe(TAG_CHEAPEST);
    expect(out[1].tag).toBe(TAG_PRICIEST);
  });

  it("synthesizes reasoning for forced-in cards", () => {
    const affordable = [p("a", 10), p("b", 20), p("c", 30)];
    const out = ensurePriceEnds([item("b", 20)], affordable, 3);
    const cheapest = out.find((x) => x.tag === TAG_CHEAPEST);
    const priciest = out.find((x) => x.tag === TAG_PRICIEST);
    expect(cheapest?.reasoning).toContain("cheapest");
    expect(priciest?.reasoning).toContain("priciest");
  });

  it("returns the hand unchanged when the pool is empty", () => {
    const hand = [item("a", 10)];
    expect(ensurePriceEnds(hand, [], 0)).toBe(hand);
  });
});
