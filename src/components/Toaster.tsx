"use client";

import { useEffect, useState } from "react";
import { TOAST_EVENT } from "@/lib/ui";

interface Toast {
  id: number;
  message: string;
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const message = (e as CustomEvent<string>).detail;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, message }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span className="toast-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 6.5 5 9.5 10 3" />
            </svg>
          </span>
          {t.message}
          <button
            className="toast-x"
            aria-label="Dismiss notification"
            onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
