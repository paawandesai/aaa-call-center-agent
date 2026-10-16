import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({ handoff_id: z.number().int().positive(), flag: z.enum(["summary_wrong", "could_have_answered"]) });

export async function POST(req: Request) {
  if (!(await requireSession("staff"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "bad_request" }, { status: 400 });
  await db().query(`INSERT INTO staff_flags (handoff_id, flag) SELECT id, $2 FROM handoffs WHERE id = $1 ON CONFLICT DO NOTHING`, [b.data.handoff_id, b.data.flag]);
  return Response.json({ ok: true });
}
