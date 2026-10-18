import { clientIp, ipBucket, ipCandidates } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff only: shows how this request's own address reaches the app, so the CLIENT_IP_SOURCE choice can be checked on the
// live host by sending spoofed X-Forwarded-For and X-Real-IP headers. Only the caller's own address buckets are returned.
export async function GET(req: Request) {
  if (!(await requireSession("staff"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const c = ipCandidates(req);
  const xffCount = (req.headers.get("x-forwarded-for") ?? "").split(",").filter((p) => p.trim()).length;
  return Response.json({
    source: process.env.CLIENT_IP_SOURCE ?? "xff_last",
    used: clientIp(req),
    xff_entries: xffCount,
    candidates: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ? ipBucket(v) : null])),
  });
}
