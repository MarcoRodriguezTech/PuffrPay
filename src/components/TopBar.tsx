"use client";

// The slim bar above page content: page title + subtitle on the left, the
// budget pill and the owner avatar chip on the right.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ASSETS } from "@/lib/assets";
import { BUDGET_EVENT, fmtWhole } from "@/lib/ui";
import { PufferGauge } from "./PufferGauge";
import { LeashBar } from "./LeashBar";
import { ThemeToggle } from "./ThemeToggle";

const TITLES: [match: RegExp, title: string, subtitle: string][] = [
  [/^\/(agent)?$/, "Agent", "Tell Puffr what to find — it shops inside your rules."],
  [/^\/policy/, "Policy", "The spending rules Puffr can never cross."],
  [/^\/audit/, "Classic log", "The plain audit trail of every request."],
  [/^\/activity/, "Activity", "Everything Puffr did with your fun money."],
];

interface Budget {
  spentCents: number;
  capCents: number;
  ratio: number;
}

function AvatarChip() {
  const [broken, setBroken] = useState(false);
  return (
    <span className="avatar-chip" title="Account owner">
      {broken ? (
        <span className="avatar-initials" aria-hidden="true">PP</span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={ASSETS.ownerAvatar}
          alt="Owner"
          width={36}
          height={36}
          onError={() => setBroken(true)}
          // If the image 404'd before hydration, onError never fires — check
          // the completed-but-empty state on mount too.
          ref={(el) => {
            if (el && el.complete && el.naturalWidth === 0) setBroken(true);
          }}
        />
      )}
    </span>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const [budget, setBudget] = useState<Budget | null>(null);

  const load = useCallback(() => {
    fetch("/api/budget")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setBudget(b))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(BUDGET_EVENT, load);
    const t = setInterval(load, 30_000);
    return () => {
      window.removeEventListener(BUDGET_EVENT, load);
      clearInterval(t);
    };
  }, [load, pathname]);

  const [, title, subtitle] =
    TITLES.find(([re]) => re.test(pathname)) ?? [null, "PuffrPay", ""];
  const pct = budget ? Math.round(budget.ratio * 100) : 0;

  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      {/* Page-level actions (e.g. Activity filters) portal in here. */}
      <div id="topbar-actions" className="topbar-actions" />
      <div className="topbar-right">
        {budget && (
          <Link
            href="/activity"
            className="budget-pill"
            aria-label="Activity log"
            title="Fun money used this month"
          >
            <PufferGauge ratio={budget.ratio} size={28} />
            <span>
              {fmtWhole(budget.spentCents)} / {fmtWhole(budget.capCents)}
            </span>
            <LeashBar ratio={budget.ratio} width={56} />
            <span>{pct}%</span>
          </Link>
        )}
        <ThemeToggle />
        <AvatarChip />
      </div>
    </header>
  );
}
