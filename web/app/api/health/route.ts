import { now } from "@/lib/config";
import { db } from "@/lib/db";
import { spendToday } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health checks touch the database only. They never call the model: the project's rules forbid monitoring that uses the
// provider's quota, so a revoked key or empty balance shows up only once real turns fail (two failures and no successes
// in an hour is enough). An uptime monitor watches this URL. It returns 503 when the knowledge base is missing, no future
// slot is open, the nightly reset is more than 26 hours old, today's spend cap is used up, or turns are failing.
export async function GET() {
  try {
    const db_ = db();
    const { rows } = await db_.query<{ chunks: number; open_slots: number; last_reset: string | null; turns_1h: number; errors_1h: number }>(
      `SELECT (SELECT count(*)::int FROM kb_chunks) AS chunks,
         (SELECT count(*)::int FROM appointment_slots WHERE status = 'open' AND start_utc > $1::timestamptz) AS open_slots,
         (SELECT value FROM app_meta WHERE key = 'last_reset') AS last_reset,
         (SELECT count(*)::int FROM events WHERE kind = 'turn' AND ts > now() - interval '1 hour' AND session_id NOT LIKE 'demo\\_%') AS turns_1h,
         (SELECT count(*)::int FROM events WHERE kind = 'turn' AND outcome = 'error' AND ts > now() - interval '1 hour' AND session_id NOT LIKE 'demo\\_%') AS errors_1h`,
      [now().toISOString()]);
    const r = rows[0];
    const spend = await spendToday(db_);
    const resetOk = !!r.last_reset && Date.now() - new Date(r.last_reset).getTime() < 26 * 3600_000;
    const okTurns = r.turns_1h - r.errors_1h;
    const errorsOk = !(r.errors_1h >= 2 && okTurns === 0) && (r.turns_1h < 5 || r.errors_1h / r.turns_1h < 0.5);
    const checks = { data: r.chunks > 0, schedule: r.open_slots > 0, reset: resetOk, spend: spend.usd < spend.cap, errors: errorsOk };
    const ok = Object.values(checks).every(Boolean);
    // Public, so it reports only pass/fail; the staff dashboard shows the details.
    return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
  } catch (e) {
    // The reason stays in the server log (no request data is in it); the public response says only that the database failed.
    console.error("health check failed:", e instanceof Error ? e.message : String(e));
    return Response.json({ ok: false, checks: { database: false } }, { status: 503 });
  }
}
