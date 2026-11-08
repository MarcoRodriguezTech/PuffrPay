"use client";

// Topbar receipts entry: a small icon button beside the avatar that opens a
// right-side drawer listing every bought item as a ReceiptCard.

import { useCallback, useEffect, useState } from "react";
import { ReceiptCard, type ReceiptPurchase } from "./ReceiptCard";
import { BUDGET_EVENT, fmtDollars, RECEIPTS_EVENT } from "@/lib/ui";

const SEEN_KEY = "puffr:receipts-seen";

export function ReceiptsDrawer() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReceiptPurchase[] | null>(null);
  const [unseen, setUnseen] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch("/api/purchases?status=PURCHASED")
      .then((r) => r.json())
      .catch(() => null);
    if (!d?.purchases) return;
    const list: ReceiptPurchase[] = d.purchases;
    setItems(list);
    const newest = list[0]?.updatedAt ?? list[0]?.createdAt;
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      /* private mode */
    }
    setUnseen(!!newest && (!seen || newest > seen));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(BUDGET_EVENT, load);
    const openDrawer = () => setOpen(true);
    window.addEventListener(RECEIPTS_EVENT, openDrawer);
    return () => {
      window.removeEventListener(BUDGET_EVENT, load);
      window.removeEventListener(RECEIPTS_EVENT, openDrawer);
    };
  }, [load]);

  // stamp "seen" + refresh whenever the drawer opens
  useEffect(() => {
    if (!open) return;
    load();
    setUnseen(false);
    const newest = items?.[0]?.updatedAt ?? items?.[0]?.createdAt;
    if (newest) {
      try {
        localStorage.setItem(SEEN_KEY, newest);
      } catch {
        /* private mode */
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const total = (items ?? []).reduce((s, p) => s + p.amountCents, 0);

  return (
    <>
      <button
        type="button"
        className="receipts-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Receipts"
        title="Receipts"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 1.5h8V14l-1.6-1.1L8.8 14 8 13.2 7.2 14l-1.6-1.1L4 14z" />
          <path d="M6 5h4M6 7.5h4M6 10h2.5" />
        </svg>
        {unseen && <span className="receipts-dot" aria-hidden="true" />}
      </button>

      {open && (
        <aside className="receipts-panel" role="dialog" aria-label="Receipts">
          <header className="ask-head">
            <div>
              <h2>Receipts</h2>
              {items && items.length > 0 && (
                <div className="receipts-sum muted">
                  {items.length} bought · {fmtDollars(total)} total
                </div>
              )}
            </div>
            <button
              type="button"
              className="ask-close"
              onClick={() => setOpen(false)}
              aria-label="Close receipts"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </header>

          <div className="ask-scroll">
            {items === null && <p className="empty-note">Loading…</p>}
            {items?.length === 0 && (
              <p className="empty-note">
                Nothing bought yet — receipts land here when Puffr buys.
              </p>
            )}
            {items?.map((p, i) => (
              <ReceiptCard key={(p as { id?: number }).id ?? i} purchase={p} />
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
