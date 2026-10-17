// Railway pre-deploy: migrate, seed from the partner's mock DB on first deploy, (re)load KB vectors when the
// embedding model id changes. Seed files are uploaded with the deploy into .seed/ and never committed.
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "../lib/config";
import { pgDb } from "../lib/db";
import { seedDemoActivity } from "../lib/demoseed";
import { loadKb } from "../lib/kbload";
import { migrate } from "../lib/migrate";
import { loadSeedFromSqlite, resetLiveTables, seedRailCustomers } from "../lib/seed";

const d = pgDb(process.env.DATABASE_URL!);
await migrate(d);
const seedDir = process.env.SEED_DIR ?? path.join(process.cwd(), ".seed");
const sqlite = path.join(seedDir, "meridian_scheduling.sqlite");
const { rows } = await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM seed_appointment_slots`);
if (rows[0].n === 0 || process.env.SEED_FORCE === "1") {
  if (!existsSync(sqlite)) throw new Error(`seed file missing at ${sqlite}`);
  await loadSeedFromSqlite(d, sqlite);
  console.log("seeded scheduling tables");
} else if (process.env.RESET_ON_DEPLOY === "1") {
  await resetLiveTables(d);
}
// The chat rail's synthetic demo customers come with each reset; add them now if this database predates them.
if ((await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM customers WHERE customer_id LIKE 'RAIL-%'`)).rows[0].n === 0) {
  await d.tx((q) => seedRailCustomers(q));
  console.log("added the synthetic demo customers");
}
const kb = await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM kb_chunks WHERE embed_model = $1`, [config.embedTag]);
const chunks = path.join(seedDir, "chunks.json");
if ((kb.rows[0].n === 0 || process.env.KB_FORCE === "1") && existsSync(chunks)) console.log("kb chunks loaded:", await loadKb(d, chunks));
// Synthetic staff-console activity (labelled demo_); set DEMO_ACTIVITY=0 to skip.
if (process.env.DEMO_ACTIVITY !== "0") console.log("demo activity:", await seedDemoActivity(d));
await d.close();
