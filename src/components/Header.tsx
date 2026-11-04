"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MASCOT_SRC, stateForRatio } from "./PufferGauge";

const NAV = [
  { href: "/agent", label: "Agent" },
  { href: "/policy", label: "Policy" },
  { href: "/audit", label: "Audit log" },
];

export function Header() {
  const pathname = usePathname();
  const [budget, setBudget] = useState<{
    spentCents: number;
    capCents: number;
    ratio: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/budget")
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => alive && b && setBudget(b))
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  const pct = budget ? Math.round(budget.ratio * 100) : null;
  const state = budget ? stateForRatio(budget.ratio) : "calm";
  const fmt = (c: number) => `$${Math.round(c / 100)}`;

  return (
    <header className="app-header">
      <span className="logo">&lt;(o_o)&gt; PUFFRPAY</span>
      <nav className="app-nav">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={pathname.startsWith(n.href) ? "active" : ""}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      {budget && (
        <span className={`header-gauge puffer ${state}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MASCOT_SRC} alt="" width={34} height={34} className="art" />
          <span>
            {fmt(budget.spentCents)} / {fmt(budget.capCents)} · {pct}%
          </span>
        </span>
      )}
    </header>
  );
}
