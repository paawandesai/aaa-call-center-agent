import { z } from "zod";
import { db } from "@/lib/db";
import { allow, clientIp } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { record } from "@/lib/telemetry";

export const runtime = "nodejs";

// Client timings only: opaque ids and numbers.
const Body = z.object({ turn_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), ttft_ms: z.number().int().min(0).max(600_000).optional(),
  total_ms: z.number().int().min(0).max(600_000), interrupted: z.boolean().optional() });

export async function POST(req: Request) {
  const s = await requireSession();
  if (!s) return new Response(null, { status: 401 });
  if (!allow(`tel:${s.id}`, 60, 60_000).ok || !allow(`telip:${clientIp(req)}`, 120, 60_000).ok) return new Response(null, { status: 429 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return new Response(null, { status: 400 });
  // Only for a turn this session actually ran, and once per turn, so a client can't pad the latency numbers.
  const { rows } = await db().query(`SELECT
      EXISTS (SELECT 1 FROM events WHERE session_id = $1 AND turn_id = $2 AND kind IN ('turn', 'capacity')) AS ran,
      EXISTS (SELECT 1 FROM events WHERE session_id = $1 AND turn_id = $2 AND kind = 'client_timing') AS seen`, [s.id, b.data.turn_id]);
  if (!rows[0]?.ran || rows[0]?.seen) return new Response(null, { status: 204 });
  await record({ session_id: s.id, turn_id: b.data.turn_id, kind: "client_timing", first_token_ms: b.data.ttft_ms,
    latency_ms: b.data.total_ms, meta: { interrupted: b.data.interrupted ?? false } });
  return new Response(null, { status: 204 });
}
