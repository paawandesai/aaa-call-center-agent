import { db } from "./db";
import { resetLiveTables } from "./seed";

// Nightly reset at 03:00 Central, run lazily by the first request after that time (single instance).
// An advisory lock makes concurrent callers skip instead of resetting twice.
let checkedAt = 0;
export async function maybeNightlyReset() {
  if (Date.now() - checkedAt < 60_000) return;
  checkedAt = Date.now();
  const d = db();
  const { rows } = await d.query<{ due: boolean }>(`SELECT coalesce(
      (SELECT value::timestamptz FROM app_meta WHERE key = 'last_reset') <
      (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '3 hours') AT TIME ZONE 'America/Chicago'
      AND now() >= (date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '3 hours') AT TIME ZONE 'America/Chicago',
    false) AS due`);
  if (!rows[0]?.due) return;
  const { rows: lock } = await d.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(424242) AS ok`);
  if (!lock[0]?.ok) return;
  try {
    await resetLiveTables(d);
    await d.query(`DELETE FROM handoffs WHERE created_at < now() - interval '7 days'`);
    await d.query(`DELETE FROM feedback WHERE created_at < now() - interval '30 days'`);
  } finally {
    await d.query(`SELECT pg_advisory_unlock(424242)`);
  }
}
