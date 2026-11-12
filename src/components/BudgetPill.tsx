"use client";

// Compact month-to-date receipt for the top bar: small state fish, leash bar,
// spent / left. Refetches whenever anything calls refreshBudget().

import { useCallback, useEffect, useState } from "react";
import { LeashBar } from "./LeashBar";
import { PufferGauge } from "./PufferGauge";
import { BUDGET_EVENT, fmtDollars, fmtWhole } from "@/lib/ui";

interface Budget {
  spentCents: number;
  capCents: number;
  ratio: number;
}

export function BudgetPill() {
  const [budget, setBudget] = useState<Budget | null>(null);

  const load = useCallback(async () => {
    const b = await fetch("/api/budget")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (b?.capCents != null) setBudget(b);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 10_000);
    window.addEventListener(BUDGET_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(BUDGET_EVENT, load);
    };
  }, [load]);

  if (!budget) return <span className="budget-pill is-loading" aria-hidden="true" />;

  const left = budget.capCents - budget.spentCents;
  const summary = `${fmtDollars(budget.spentCents)} spent, ${
    left < 0
      ? `${fmtDollars(-left)} over`
      : `${fmtDollars(left)} left`
  } of ${fmtWhole(budget.capCents)} this month`;

  return (
    <span className="budget-pill" role="group" aria-label={`Fun money: ${summary}`} title={summary}>
      <PufferGauge ratio={budget.ratio} size={28} />
      <span className="bp-main">
        <span className="bp-text">
          <span className="bp-spent">
            <strong>{fmtDollars(budget.spentCents)}</strong> spent
          </span>
          <span className={left < 0 ? "bp-left over" : "bp-left"}>
            <strong>{fmtDollars(Math.abs(left))}</strong> {left < 0 ? "over" : "left"}
          </span>
        </span>
        <LeashBar ratio={budget.ratio} width="100%" />
      </span>
    </span>
  );
}
