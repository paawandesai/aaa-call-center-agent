import { z } from "zod";
import { allow } from "@/lib/ratelimit";
import { COOKIE, createSession, roleForCode } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const rl = allow(`invite:${ip}`, 10, 10 * 60_000);
  if (!rl.ok) return Response.json({ error: "rate_limited", retry_after_s: rl.retryAfterS }, { status: 429 });
  const b = z.object({ code: z.string().min(1).max(100) }).safeParse(await req.json().catch(() => null));
  const role = b.success ? roleForCode(b.data.code) : null;
  if (!role) return Response.json({ error: "invalid_code" }, { status: 401 });
  const s = await createSession(role);
  const res = Response.json({ role });
  res.headers.append("Set-Cookie", `${COOKIE}=${s.value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${s.maxAge}`);
  return res;
}
