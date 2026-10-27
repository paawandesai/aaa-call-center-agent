"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/clienterror-report";

// Last resort when the root layout itself fails: it replaces the whole document, so it has its own html and body.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { reportClientError(error, "render", error.digest); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 560 }}>
        <h1>This page didn&apos;t load properly</h1>
        <p>Something went wrong in your browser while loading the page, often a brief network problem. It has been logged
          (no message text). Please reload.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </body>
    </html>
  );
}
