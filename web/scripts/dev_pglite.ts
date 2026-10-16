// Local development and browser tests only: in-process Postgres seeded from the mock DB and KB chunks.
import path from "node:path";
import { loadKb } from "../lib/kbload";
import { migrate } from "../lib/migrate";
import { loadSeedFromSqlite } from "../lib/seed";
import { pgliteDb } from "../test/pglite";

export async function devDb() {
  const d = await pgliteDb();
  await migrate(d, path.join(process.cwd(), "db", "migrations"));
  const data = process.env.MERIDIAN_DATA_DIR ?? "/mnt/project-files/data/meridian_dataset";
  await loadSeedFromSqlite(d, path.join(data, "scheduling_db/meridian_scheduling.sqlite"));
  await loadKb(d, process.env.KB_CHUNKS ?? "/mnt/project-files/data/kb/chunks.json");
  return d;
}
