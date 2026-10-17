import { config } from "@/lib/config";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Railway's deploy check. It asks only whether this server can answer: the database responds and the knowledge base has
// vectors for the embedding model this build searches with. Business checks (spend cap, failing turns, open slots) stay
// on /api/health for the uptime monitor, so a key rotation or a schedule fix can still deploy while those are red.
export async function GET() {
  try {
    const { rows } = await db().query<{ chunks: number }>(`SELECT count(*)::int AS chunks FROM kb_chunks WHERE embed_model = $1`, [config.embedTag]);
    const ok = rows[0].chunks > 0;
    return Response.json({ ok, checks: { database: true, data: ok } }, { status: ok ? 200 : 503 });
  } catch (e) {
    console.error("live check failed:", e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false, checks: { database: false } }, { status: 503 });
  }
}
