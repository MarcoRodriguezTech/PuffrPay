"use client";

// The slim bar above page content: page title + subtitle on the left, the
// owner avatar chip on the right.

import { usePathname } from "next/navigation";
import { useState } from "react";
import { ASSETS } from "@/lib/assets";
import { ThemeToggle } from "./ThemeToggle";

const TITLES: [match: RegExp, title: string, subtitle: string][] = [
  [/^\/(agent)?$/, "Agent", "Tell Puffr what to find — it shops inside your rules."],
  [/^\/policy/, "Policy", "The spending rules Puffr can never cross."],
  [/^\/audit/, "Classic log", "The plain audit trail of every request."],
  [/^\/activity/, "Activity", "Everything Puffr did with your fun money."],
];

function AvatarChip() {
  const [broken, setBroken] = useState(false);
  return (
    <span className="avatar-chip" title="Account owner">
      {!ASSETS.ownerAvatar || broken ? (
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

  const [, title, subtitle] =
    TITLES.find(([re]) => re.test(pathname)) ?? [null, "PuffrPay", ""];

  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      {/* Page-level actions (e.g. Activity filters) portal in here. */}
      <div id="topbar-actions" className="topbar-actions" />
      <div className="topbar-right">
        <ThemeToggle />
        <AvatarChip />
      </div>
    </header>
  );
}
