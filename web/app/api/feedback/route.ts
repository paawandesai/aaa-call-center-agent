import { z } from "zod";
import { db } from "@/lib/db";
import { allow, clientIp } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({ turn_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), rating: z.enum(["up", "down"]),
  category: z.enum(["wrong_info", "should_have_answered", "should_have_handed_off", "other"]).optional() });

// Feedback lands in the staff review queue. Nothing is promoted into the KB or prompts automatically.
export async function POST(req: Request) {
  const s = await requireSession();
  if (!s) return new Response(null, { status: 401 });
  if (!allow(`fb:${s.id}`, 30, 60_000).ok || !allow(`fbip:${clientIp(req)}`, 60, 60_000).ok) return new Response(null, { status: 429 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return new Response(null, { status: 400 });
  await db().query(`INSERT INTO feedback (session_id, turn_id, rating, category) VALUES ($1,$2,$3,$4)`,
    [s.id, b.data.turn_id, b.data.rating, b.data.category ?? null]);
  return new Response(null, { status: 204 });
}
