"use client";

// The floating left rail (desktop) / bottom tab bar (under 1100px).
// Three destinations only — Agent, Policy, Activity — as icon buttons with
// labels, plus the theme toggle and a Sandbox badge at the bottom.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ASSETS } from "@/lib/assets";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  {
    href: "/",
    label: "Agent",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M4 5.5h16v10.5H10l-6 4.5V5.5Z" />
      </svg>
    ),
  },
  {
    href: "/policy",
    label: "Policy",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 6.5h16M4 12h16M4 17.5h16" />
        <circle cx="9" cy="6.5" r="2" fill="currentColor" stroke="none" />
        <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
        <circle cx="10" cy="17.5" r="2" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/activity",
    label: "Activity",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 20v-8M10 20V6M16 20v-6M21 20V4" />
      </svg>
    ),
  },
];

const isActive = (href: string, pathname: string) =>
  href === "/"
    ? pathname === "/" || pathname.startsWith("/agent")
    : href === "/activity"
      ? pathname.startsWith("/activity") || pathname.startsWith("/audit")
      : pathname.startsWith(href);

export function SideRail() {
  const pathname = usePathname();

  return (
    <nav className="rail" aria-label="Main">
      <Link href="/" className="rail-logo" aria-label="PuffrPay home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ASSETS.logoMark} alt="" width={40} height={40} />
      </Link>

      <div className="rail-nav">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`rail-btn${isActive(n.href, pathname) ? " active" : ""}`}
            aria-label={n.label}
            title={n.label}
          >
            <span className="rail-ico">{n.icon}</span>
            <span className="rail-label">{n.label}</span>
          </Link>
        ))}
      </div>

      <div className="rail-foot">
        <ThemeToggle className="rail-toggle" />
        <span className="sandbox-badge">Sandbox</span>
      </div>
    </nav>
  );
}
