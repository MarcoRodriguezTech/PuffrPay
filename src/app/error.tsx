"use client";

import { MASCOT_SRC } from "@/components/PufferGauge";

// The real error is logged by Next on the server; the UI only gets the
// friendly line — never raw error text.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <div className="error-page">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MASCOT_SRC} alt="" width={120} height={120} />
        <h1>Something went wrong on our side. Try again.</h1>
        <div className="row" style={{ justifyContent: "center" }}>
          <button onClick={reset}>Try again</button>
        </div>
      </div>
    </main>
  );
}
