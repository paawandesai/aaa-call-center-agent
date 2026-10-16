import { z } from "zod";
import { allow } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { record } from "@/lib/telemetry";

export const runtime = "nodejs";

// Client timings only: opaque ids and numbers.
const Body = z.object({ turn_id: z.string().max(64), ttft_ms: z.number().int().min(0).max(600_000).optional(),
  total_ms: z.number().int().min(0).max(600_000), interrupted: z.boolean().optional() });

export async function POST(req: Request) {
  const s = await requireSession();
  if (!s) return new Response(null, { status: 401 });
  if (!allow(`tel:${s.id}`, 60, 60_000).ok) return new Response(null, { status: 429 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return new Response(null, { status: 400 });
  await record({ session_id: s.id, turn_id: b.data.turn_id, kind: "client_timing", first_token_ms: b.data.ttft_ms,
    latency_ms: b.data.total_ms, meta: { interrupted: b.data.interrupted ?? false } });
  return new Response(null, { status: 204 });
}
