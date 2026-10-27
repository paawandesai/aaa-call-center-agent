"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/clienterror-report";

// Reports errors that happen outside React's error boundaries: a script or stylesheet that failed to download, an uncaught
// error, or a rejected promise. Errors inside React are reported by app/error.tsx and app/global-error.tsx.
export function ErrorReporter() {
  useEffect(() => {
    const onError = (ev: Event) => {
      const t = ev.target;
      if (t instanceof HTMLScriptElement || t instanceof HTMLLinkElement) reportClientError(undefined, "script");
      else if (ev instanceof ErrorEvent) reportClientError(ev.error, "unhandled");
    };
    const onRejection = (ev: PromiseRejectionEvent) => reportClientError(ev.reason, "unhandled");
    window.addEventListener("error", onError, true); // capture, so resource load failures (which don't bubble) are seen
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError, true); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
