"use client";
import { classify, errorName, pageOf, type ClientErrorKind, type ClientErrorReport } from "./clienterror";

// At most a few reports per page load, each kind and name once, so a crash loop can't flood the endpoint.
const sent = new Set<string>();

export function reportClientError(e: unknown, fallback: ClientErrorKind, digest?: string) {
  try {
    const r: ClientErrorReport = { kind: classify(e, fallback), page: pageOf(window.location.pathname), name: errorName(e) };
    if (digest && /^[A-Za-z0-9]{1,32}$/.test(digest)) r.digest = digest;
    const key = `${r.kind}:${r.name ?? ""}`;
    if (sent.has(key) || sent.size >= 5) return;
    sent.add(key);
    void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r), keepalive: true })
      .catch(() => {});
  } catch {
    // Reporting must never make an error worse.
  }
}
