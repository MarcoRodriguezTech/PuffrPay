"use client";

import Image from "next/image";
import { MASCOT_SRC } from "@/components/PufferGauge";

// The real error is logged by Next on the server; the UI only gets the
// friendly line — never raw error text.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <main className="page">
      <div className="error-page">
        <Image src={MASCOT_SRC} alt="" width={120} height={74} quality={90} style={{ height: "auto" }} />
        <h1>Something went wrong on our side. Try again.</h1>
        <div className="row" style={{ justifyContent: "center" }}>
          <button onClick={reset}>Try again</button>
        </div>
      </div>
    </main>
  );
}
