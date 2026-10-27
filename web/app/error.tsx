"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/clienterror-report";
import { isChunkLoadError } from "@/lib/clienterror";

// Shown when a page fails in the browser. A failed script download needs a full reload; other errors can retry in place.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportClientError(error, "render", error.digest); }, [error]);
  const reload = isChunkLoadError(error);
  return (
    <main className="staff-main" style={{ maxWidth: 560 }}>
      <h1 className="h1">This page didn&apos;t load properly</h1>
      <p>Something went wrong in your browser while loading the page, often a brief network problem. It has been logged
        (no message text). Please try again.</p>
      <p><button type="button" className="btn" onClick={() => (reload ? window.location.reload() : reset())}>Try again</button></p>
    </main>
  );
}
