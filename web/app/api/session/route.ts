import { z } from "zod";
import { allow, clientIp } from "@/lib/ratelimit";
import { db } from "@/lib/db";
import { COOKIE, createSession, requireSession, roleForCode } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Per IPv4 address or IPv6 /64. A ceiling on failed attempts from everyone applies only after the code is compared,
  // so a flood of wrong codes can slow guessing but never locks out someone with the right code.
  const ip = clientIp(req);
  const rl = allow(`invite:${ip}`, 10, 10 * 60_000);
  if (!rl.ok) return Response.json({ error: "rate_limited", retry_after_s: rl.retryAfterS }, { status: 429 });
  const b = z.object({ code: z.string().min(1).max(100) }).safeParse(await req.json().catch(() => null));
  const role = b.success ? roleForCode(b.data.code) : null;
  if (!role) {
    const all = allow("invitefail:all", 1000, 60 * 60_000);
    return all.ok ? Response.json({ error: "invalid_code" }, { status: 401 })
      : Response.json({ error: "rate_limited", retry_after_s: all.retryAfterS }, { status: 429 });
  }
  const s = await createSession(role);
  const res = Response.json({ role });
  res.headers.append("Set-Cookie", `${COOKIE}=${s.value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${s.maxAge}`);
  return res;
}

// Sign out: end the session row and clear the cookie, so the invite page shows again.
export async function DELETE() {
  const s = await requireSession();
  if (s) await db().query(`DELETE FROM sessions WHERE session_id = $1`, [s.id]);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return res;
}
