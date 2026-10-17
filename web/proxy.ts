import { NextResponse, type NextRequest } from "next/server";

// Only CSP nonce and headers here. Authorization happens in each route handler and server component.
export function proxy(request: NextRequest) {
  // API writes (POST, and DELETE for sign-out): refuse requests a browser marks as cross-site (cookies are SameSite=Strict
  // too), and POST bodies over 32 KB or with no Content-Length (chunked), so the cap can't be sidestepped.
  if ((request.method === "POST" || request.method === "DELETE") && request.nextUrl.pathname.startsWith("/api/")) {
    if (request.method === "POST") {
      const len = request.headers.get("content-length");
      if (len === null || Number(len) > 32_768) return new NextResponse(null, { status: len === null ? 411 : 413 });
    }
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return new NextResponse(null, { status: 403 });
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // React style attributes; scripts stay nonce-only
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.delete("x-middleware-subrequest"); // CVE-2025-29927 class: never trust this header from outside
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Permissions-Policy", "microphone=(), camera=(), geolocation=()");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
