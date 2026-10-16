import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({ turn_id: z.string().max(64), flag: z.enum(["stale_fact", "missed_handoff", "could_have_answered", "caller_feedback", "other"]),
  decision: z.enum(["agree", "disagree", "needs_fix"]), proposed_fix: z.string().max(500).optional(), add_to_regression: z.boolean() });

export async function POST(req: Request) {
  if (!(await requireSession("staff"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "bad_request" }, { status: 400 });
  await db().query(`INSERT INTO reviews (turn_id, flag, decision, proposed_fix, add_to_regression) VALUES ($1,$2,$3,$4,$5)`,
    [b.data.turn_id, b.data.flag, b.data.decision, b.data.proposed_fix ?? null, b.data.add_to_regression]);
  return Response.json({ ok: true });
}
