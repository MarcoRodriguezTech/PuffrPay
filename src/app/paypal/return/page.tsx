"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function ReturnInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"working" | "ok" | "err">("working");
  const [detail, setDetail] = useState("");

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
        setDetail(
          `"${d.purchase.productTitle}" — $${(d.purchase.amountCents / 100).toFixed(2)} captured${d.purchase.paypalCaptureId ? ` (${d.purchase.paypalCaptureId})` : ""}.`
        );
      })
      .catch((e) => {
        setState("err");
        setDetail(e instanceof Error ? e.message : String(e));
      });
  }, [token]);

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 520 }}>
        {state === "working" && <p>Capturing the sandbox payment…</p>}
        {state === "ok" && (
          <>
            <h3 style={{ marginTop: 0 }}>Payment captured</h3>
            <p>{detail}</p>
            <p className="muted">You can close this tab.</p>
          </>
        )}
        {state === "err" && (
          <>
            <h3 style={{ marginTop: 0 }}>Capture did not complete</h3>
            <p className="error">{detail}</p>
          </>
        )}
        <Link href="/agent">← Back to the agent</Link>
      </div>
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
