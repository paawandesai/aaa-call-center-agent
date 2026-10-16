// Local smoke run: in-process Postgres seeded from the mock DB, real embeddings, real model.
// Prints event types and model text for a few scripted conversations. Uses ANTHROPIC_AEA_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { runTurn } from "../lib/agent";
import { getConversation } from "../lib/conversations";
import { setDb } from "../lib/db";
import { loadKb } from "../lib/kbload";
import { migrate } from "../lib/migrate";
import { searchKb } from "../lib/retrieval";
import { confirmBooking } from "../lib/scheduling";
import { loadSeedFromSqlite } from "../lib/seed";
import { pgliteDb } from "../test/pglite";

process.env.DEMO_NOW ??= "2026-10-16T15:00:00Z";
const data = process.env.MERIDIAN_DATA_DIR ?? "/mnt/project-files/data/meridian_dataset";
const d = await pgliteDb();
setDb(d);
await migrate(d);
await loadSeedFromSqlite(d, path.join(data, "scheduling_db/meridian_scheduling.sqlite"));
console.log("kb chunks", await loadKb(d, process.env.KB_CHUNKS ?? "/mnt/project-files/data/kb/chunks.json"));
await d.query(`INSERT INTO sessions (session_id, role, expires_at) VALUES ('smoke','caller', now() + interval '1 day')`);
const deps = { db: d, anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_AEA_API_KEY }), search: (q: string) => searchKb(d, q) };

const scripts: string[][] = JSON.parse(process.argv[2] ?? "[]");
for (const [i, turns] of scripts.entries()) {
  const c = getConversation("smoke", `conv${i}xxxxx`);
  console.log(`\n=== conversation ${i}`);
  for (const t of turns) {
    console.log(`\n> ${t}`);
    let text = "";
    const r = await runTurn(deps, c, t, (e) => {
      if (e.type === "text_delta") text += e.text;
      else console.log(`  [${e.type}] ${JSON.stringify(e).slice(0, 260)}`);
    });
    console.log(`  text: ${text}`);
    console.log(`  outcome=${r.outcome} tools=${r.toolCalls.join(",")} in=${r.inputTokens} out=${r.outputTokens} ttft=${r.firstTokenMs} top=${r.topScore?.toFixed(3)}`);
    if (r.outcome === "confirm_shown" && c.pending) {
      const b = await d.tx((q) => confirmBooking(q, c.pending!, `idem-${i}`));
      console.log(`  [confirm pressed] ${JSON.stringify(b)}`);
      if (b.ok) c.notes.push(`The caller pressed Confirm and the app booked it, reference ${b.ref}.`);
    }
  }
}
await d.close();
