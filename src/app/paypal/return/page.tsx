"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ReceiptCard, type ReceiptPurchase } from "@/components/ReceiptCard";

function ReturnInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"working" | "ok" | "err">("working");
  const [detail, setDetail] = useState("");
  const [purchase, setPurchase] = useState<ReceiptPurchase | null>(null);

  useEffect(() => {
    if (!token) {
      setState("err");
      setDetail("Missing order token in the redirect URL.");
      return;
    }
    fetch("/api/paypal/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: token }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "capture failed");
        setState("ok");
        setPurchase(d.purchase);
      })
      .catch((e) => {
        setState("err");
        setDetail(e instanceof Error ? e.message : String(e));
      });
  }, [token]);

  return (
    <main className="page cap-stage">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="cap-fish"
        src="/mascot/puffr-swelling-v4.png"
        alt="Puffr"
        width={132}
        height={132}
      />
      {state === "working" && (
        <>
          <h1 className="cap-title">Capturing…</h1>
          <p className="cap-sub">Puffr is ringing up the sandbox payment.</p>
        </>
      )}
      {state === "ok" && purchase && (
        <>
          <p className="cap-eyebrow">Payment captured · PayPal sandbox</p>
          <h1 className="cap-title">It&rsquo;s yours.</h1>
          <p className="cap-sub">
            The leash held — Puffr bought it inside your rules.
          </p>
          <div className="cap-card">
            <ReceiptCard purchase={purchase} />
          </div>
          <Link className="cap-cta" href="/">
            ← Back to the agent
          </Link>
          <p className="cap-close muted">You can close this tab.</p>
        </>
      )}
      {state === "err" && (
        <>
          <h1 className="cap-title">Capture did not complete</h1>
          <p className="cap-sub error">{detail}</p>
          <Link className="cap-cta" href="/">
            ← Back to the agent
          </Link>
        </>
      )}
    </main>
  );
}

export default function PayPalReturn() {
  return (
    <Suspense>
      <ReturnInner />
    </Suspense>
  );
}
