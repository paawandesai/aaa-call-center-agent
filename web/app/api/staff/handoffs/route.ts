import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireSession("staff"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { rows } = await db().query(
    `SELECT id::int AS id, created_at, reason, intent, steps_tried, caller_provided, slot, summary, status, resolution FROM handoffs
     WHERE created_at > now() - interval '7 days'
     ORDER BY (status = 'resolved'), (reason = 'safety') DESC, created_at ASC LIMIT 200`);
  return Response.json({ handoffs: rows });
}

const Body = z.object({ id: z.number().int(), action: z.enum(["claim", "resolve"]),
  resolution: z.enum(["resolved_by_staff", "callback_scheduled", "no_action_needed", "test"]).optional() });

export async function POST(req: Request) {
  if (!(await requireSession("staff"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const status = b.data.action === "claim" ? "claimed" : "resolved";
  await db().query(`UPDATE handoffs SET status = $2, resolution = coalesce($3, resolution) WHERE id = $1`, [b.data.id, status, b.data.resolution ?? null]);
  return Response.json({ ok: true });
}
