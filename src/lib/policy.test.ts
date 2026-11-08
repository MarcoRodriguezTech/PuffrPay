import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "./policy";
import type { Policy } from "./types";

// Default demo policy: cap $200, per-purchase max $50, auto-approve under $20
const policy: Pick<
  Policy,
  | "monthlyCapCents"
  | "perPurchaseMaxCents"
  | "autoApproveUnderCents"
  | "blockedCategories"
> = {
  monthlyCapCents: 200_00,
  perPurchaseMaxCents: 50_00,
  autoApproveUnderCents: 20_00,
  blockedCategories: ["gift cards", "weapons"],
};

const buy = (
  amountCents: number,
  category: string | null = "general",
  title: string | null = null
) => ({
  amountCents,
  category,
  title,
});

describe("evaluatePolicy", () => {
  it("allows a purchase exactly at the auto-approve limit", () => {
    const r = evaluatePolicy(policy, buy(20_00), 0);
    expect(r).toEqual({ decision: "ALLOW", reason: "under auto approve limit" });
  });

  it("blocks a purchase exactly at the per-purchase max if cap would be exceeded", () => {
    // exactly at max but month total is full
    const r = evaluatePolicy(policy, buy(50_00), 200_00);
    expect(r).toEqual({ decision: "BLOCK", reason: "would exceed monthly cap" });
  });

  it("asks when exactly at the per-purchase max with room in the month", () => {
    const r = evaluatePolicy(policy, buy(50_00), 0);
    expect(r).toEqual({ decision: "ASK", reason: "needs owner approval" });
  });

  it("blocks one cent over the per-purchase max", () => {
    const r = evaluatePolicy(policy, buy(50_01), 0);
    expect(r).toEqual({ decision: "BLOCK", reason: "over per purchase max" });
  });

  it("blocks one cent over the monthly cap", () => {
    const r = evaluatePolicy(policy, buy(19_99), 180_02);
    expect(r).toEqual({ decision: "BLOCK", reason: "would exceed monthly cap" });
  });

  it("allows when the purchase exactly fills the monthly cap", () => {
    const r = evaluatePolicy(policy, buy(19_99), 180_01);
    expect(r).toEqual({ decision: "ALLOW", reason: "under auto approve limit" });
  });

  it("blocks a small purchase that pushes past the monthly cap", () => {
    const r = evaluatePolicy(policy, buy(5_00), 199_00);
    expect(r).toEqual({ decision: "BLOCK", reason: "would exceed monthly cap" });
  });

  it("blocks a blocked category before any amount check", () => {
    const r = evaluatePolicy(policy, buy(1_00, "gift cards"), 0);
    expect(r).toEqual({ decision: "BLOCK", reason: "blocked category" });
  });

  it("matches blocked categories case-insensitively and trims whitespace", () => {
    const r = evaluatePolicy(policy, buy(1_00, "  Gift Cards "), 0);
    expect(r.decision).toBe("BLOCK");
  });

  it("matches blocked words inside catalog taxonomy categories", () => {
    // Channel3-style taxonomy never equals owner vocabulary exactly.
    const r = evaluatePolicy(policy, buy(1_00, "Gift Giving"), 0);
    expect(r.decision).toBe("BLOCK");
  });

  it("matches blocked words against the product title", () => {
    const r = evaluatePolicy(
      policy,
      buy(1_00, "Hobby Kits", "Replica Weapon Model Kit"),
      0
    );
    expect(r.decision).toBe("BLOCK");
  });

  it("does not block when no blocked word appears in category or title", () => {
    const r = evaluatePolicy(
      policy,
      buy(1_00, "Climbing Shoes", "Approach Shoe"),
      0
    );
    expect(r.decision).toBe("ALLOW");
  });

  it("two purchases in a row: first fills the cap, second is blocked", () => {
    // First purchase is auto-approved for $19.99 when $180.01 spent -> exactly $200
    const first = evaluatePolicy(policy, buy(19_99), 180_01);
    expect(first.decision).toBe("ALLOW");
    const spentAfter = 180_01 + 19_99;
    // Second purchase for any amount is blocked because the cap is full
    const second = evaluatePolicy(policy, buy(1_00), spentAfter);
    expect(second).toEqual({
      decision: "BLOCK",
      reason: "would exceed monthly cap",
    });
  });

  it("demo case: $51 request is blocked (over $50 per-purchase max)", () => {
    const r = evaluatePolicy(policy, buy(51_00), 0);
    expect(r).toEqual({ decision: "BLOCK", reason: "over per purchase max" });
  });

  it("demo case: $19 request is allowed (under $20 auto-approve)", () => {
    const r = evaluatePolicy(policy, buy(19_00), 0);
    expect(r).toEqual({ decision: "ALLOW", reason: "under auto approve limit" });
  });

  it("asks for a mid-priced item within limits", () => {
    const r = evaluatePolicy(policy, buy(34_00), 0);
    expect(r).toEqual({ decision: "ASK", reason: "needs owner approval" });
  });

  it("asks when one cent over the auto-approve limit", () => {
    const r = evaluatePolicy(policy, buy(20_01), 0);
    expect(r).toEqual({ decision: "ASK", reason: "needs owner approval" });
  });
});
