"use client";

import { useEffect } from "react";

export default function ActivityError({ error }: { error: Error }) {
  useEffect(() => {
    console.error("[/activity] render error:", error);
  }, [error]);

  return (
    <main className="page">
      <h1>Activity</h1>
      <p className="notice">
        The activity report didn&apos;t load.{" "}
        <a href="/audit/classic">Open the classic log</a> — it shows the same
        purchase requests.
      </p>
    </main>
  );
}
