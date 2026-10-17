import { db, type Db } from "./db";
import { sweepConversations } from "./conversations";
import { seedDemoActivity } from "./demoseed";
import { resetLiveTablesIn } from "./seed";

// Nightly reset and retention purges at 03:00 Central. A timer started at server boot (instrumentation.ts) checks every
// five minutes, so they run with no traffic; chat requests also check, as a backstop. Everything runs in one transaction
// that holds a transaction-scoped advisory lock, so the lock and its release are always on the same connection and a
// second caller skips instead of resetting twice.
const DUE = `coalesce(
    (SELECT value::timestamptz FROM app_meta WHERE key = 'last_reset') <
    (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '3 hours') AT TIME ZONE 'America/Chicago'
    AND now() >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '3 hours') AT TIME ZONE 'America/Chicago',
  true)`;

let checkedAt = 0;
export async function maybeNightlyReset(d: Db = db()): Promise<boolean> {
  if (Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  const { rows } = await d.query<{ due: boolean }>(`SELECT ${DUE} AS due`);
  if (!rows[0]?.due) return false;
  return d.tx(async (q) => {
    const { rows: lock } = await q.query<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock(424242) AS ok`);
    if (!lock[0]?.ok) return false;
    const { rows: again } = await q.query<{ due: boolean }>(`SELECT ${DUE} AS due`);
    if (!again[0]?.due) return false;
    await resetLiveTablesIn(q);
    await q.query(`DELETE FROM handoffs WHERE created_at < now() - interval '7 days'`);
    await q.query(`DELETE FROM feedback WHERE created_at < now() - interval '30 days'`);
    await q.query(`DELETE FROM staff_flags WHERE created_at < now() - interval '30 days'`);
    await q.query(`DELETE FROM reviews WHERE created_at < now() - interval '30 days'`);
    await q.query(`DELETE FROM app_meta WHERE key LIKE 'spend:%' AND key < 'spend:' || to_char(now() - interval '30 days', 'YYYY-MM-DD')`);
    if (process.env.DEMO_ACTIVITY !== "0") await seedDemoActivity(q);
    return true;
  });
}

export function startResetTimer() {
  const g = globalThis as { __resetTimer?: ReturnType<typeof setInterval> };
  if (g.__resetTimer || !process.env.DATABASE_URL) return;
  const tick = () => { sweepConversations(); checkedAt = 0; maybeNightlyReset().catch(() => {}); };
  g.__resetTimer = setInterval(tick, 5 * 60_000);
  g.__resetTimer.unref?.();
  setTimeout(tick, 30_000).unref?.();
}
