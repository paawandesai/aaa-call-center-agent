import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health checks touch the database only. They never call the model.
export async function GET() {
  try {
    const { rows } = await db().query<{ chunks: number; slots: number }>(
      `SELECT (SELECT count(*)::int FROM kb_chunks) AS chunks, (SELECT count(*)::int FROM appointment_slots) AS slots`);
    const ok = rows[0].chunks > 0 && rows[0].slots > 0;
    return Response.json({ ok }, { status: ok ? 200 : 503 });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
