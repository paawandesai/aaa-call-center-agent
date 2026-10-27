// Browser-side errors, reported as metadata only: which page, what kind, the error's class name and Next's digest.
// Never the error message or stack, which can carry page or caller text. Shared by the reporter and the API route.
export const CLIENT_ERROR_PAGES = ["/", "/chat", "/staff", "/evaluation", "/privacy", "/notices", "other"] as const;
// render: an error boundary caught it. chunk_load: a script chunk failed to download. script: a <script> or stylesheet
// tag failed to load. unhandled: an uncaught error or rejected promise outside React.
export const CLIENT_ERROR_KINDS = ["render", "chunk_load", "script", "unhandled"] as const;
export type ClientErrorPage = (typeof CLIENT_ERROR_PAGES)[number];
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];
export interface ClientErrorReport { kind: ClientErrorKind; page: ClientErrorPage; name?: string; digest?: string }

export function pageOf(pathname: string): ClientErrorPage {
  if (pathname === "/" || pathname === "/chat") return pathname;
  const top = `/${pathname.split("/")[1] ?? ""}`;
  return (CLIENT_ERROR_PAGES as readonly string[]).includes(top) ? (top as ClientErrorPage) : "other";
}

// The class name only ("TypeError", "ChunkLoadError"), and only if it looks like one.
export function errorName(e: unknown): string | undefined {
  const n = e instanceof Error ? e.name : undefined;
  return n && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(n) ? n : undefined;
}

// The message is read here to classify the error and is never sent.
export function isChunkLoadError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === "ChunkLoadError" || /Loading (CSS )?chunk|dynamically imported module|Importing a module script failed/i.test(e.message);
}

export function classify(e: unknown, fallback: ClientErrorKind): ClientErrorKind {
  return isChunkLoadError(e) ? "chunk_load" : fallback;
}
