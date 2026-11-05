"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MASCOT_SRC, PufferGauge } from "./PufferGauge";
import { LeashBar } from "./LeashBar";
import { BUDGET_EVENT, fmtWhole } from "@/lib/ui";

const NAV = [
  { href: "/", label: "Agent" },
  { href: "/policy", label: "Policy" },
  { href: "/activity", label: "Activity" },
];

interface Budget {
  spentCents: number;
  capCents: number;
  ratio: number;
}

const isActive = (href: string, pathname: string) =>
  href === "/"
    ? pathname === "/" || pathname.startsWith("/agent")
    : href === "/activity"
      ? pathname.startsWith("/activity") || pathname.startsWith("/audit")
      : pathname.startsWith(href);

const TAB_ICONS: Record<string, React.ReactNode> = {
  Agent: (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 4h14v9H8l-5 4V4Z" strokeLinejoin="round" />
    </svg>
  ),
  Policy: (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 5h12M4 10h12M4 15h12" strokeLinecap="round" />
      <circle cx="7" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="8" cy="15" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  Activity: (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 17V9M8 17V5M13 17v-7M18 17V3" strokeLinecap="round" />
    </svg>
  ),
};

// One line of low-contrast waves under the header — decorative only.
const WAVE = "~^~-~~^~".repeat(32);

export function Header() {
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

  const pct = budget ? Math.round(budget.ratio * 100) : 0;

  return (
    <>
      <header className="app-header">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MASCOT_SRC} alt="" width={32} height={32} />
          PuffrPay
        </Link>
        <nav className="app-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={isActive(n.href, pathname) ? "active" : ""}
            >
              {n.label}
            </Link>
          ))}
        </nav>
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
            <LeashBar ratio={budget.ratio} width={10} />
            <span>{pct}%</span>
          </Link>
        )}
      </header>
      <div className="wave-strip" aria-hidden="true">
        {WAVE}
      </div>
      <nav className="tab-bar" aria-label="Main">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={isActive(n.href, pathname) ? "active" : ""}
          >
            {TAB_ICONS[n.label]}
            {n.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
