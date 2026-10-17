// Local development and browser tests only: in-process Postgres seeded from the mock DB and KB chunks.
import path from "node:path";
import { seedDemoActivity } from "../lib/demoseed";
import { loadKb } from "../lib/kbload";
import { migrate } from "../lib/migrate";
import { loadSeedFromSqlite } from "../lib/seed";
import { pgliteDb } from "../test/pglite";

const need = (k: string): string => process.env[k] || (() => { throw new Error(`set ${k} (see .env.example)`); })();

export async function devDb() {
  const d = await pgliteDb();
  await migrate(d, path.join(process.cwd(), "db", "migrations"));
  const data = need("MERIDIAN_DATA_DIR");
  await loadSeedFromSqlite(d, path.join(data, "scheduling_db/meridian_scheduling.sqlite"));
  await loadKb(d, need("KB_CHUNKS"));
  if (process.env.DEMO_ACTIVITY !== "0") await seedDemoActivity(d);
  return d;
}
