import { db } from "@/lib/db";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health checks touch the database only. They never call the model. An uptime monitor watches this URL: it returns 503
// when the data is missing, the nightly reset is more than 26 hours old, or most turns in the last hour failed.
export async function GET() {
  try {
    const { rows } = await db().query<{ chunks: number; slots: number; last_reset: string | null; last_reply: string | null; turns_1h: number; errors_1h: number }>(
      `SELECT (SELECT count(*)::int FROM kb_chunks) AS chunks, (SELECT count(*)::int FROM appointment_slots) AS slots,
         (SELECT value FROM app_meta WHERE key = 'last_reset') AS last_reset,
         (SELECT max(ts)::text FROM events WHERE kind = 'turn' AND outcome <> 'error' AND session_id NOT LIKE 'demo\\_%') AS last_reply,
         (SELECT count(*)::int FROM events WHERE kind = 'turn' AND ts > now() - interval '1 hour' AND session_id NOT LIKE 'demo\\_%') AS turns_1h,
         (SELECT count(*)::int FROM events WHERE kind = 'turn' AND outcome = 'error' AND ts > now() - interval '1 hour' AND session_id NOT LIKE 'demo\\_%') AS errors_1h`);
    const r = rows[0];
    const resetOk = !!r.last_reset && Date.now() - new Date(r.last_reset).getTime() < 26 * 3600_000;
    const errorsOk = r.turns_1h < 5 || r.errors_1h / r.turns_1h < 0.5;
    const ok = r.chunks > 0 && r.slots > 0 && resetOk && errorsOk;
    return Response.json({
      ok, model: config.model, prompt_version: config.promptVersion, last_reset: r.last_reset, last_reply: r.last_reply,
      turns_last_hour: r.turns_1h, errors_last_hour: r.errors_1h, checks: { data: r.chunks > 0 && r.slots > 0, reset: resetOk, errors: errorsOk },
    }, { status: ok ? 200 : 503 });
  } catch {
    return Response.json({ ok: false, checks: { database: false } }, { status: 503 });
  }
}
