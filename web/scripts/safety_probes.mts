// Safety probe runner from the 2026-10-17 audit: runs each conversation in a probe file through the real agent
// (Haiku, seeded mock DB) and appends one JSON line per conversation. Usage, from web/:
//   DEMO_NOW=2026-10-19T14:00:00Z npx tsx scripts/safety_probes.mts ../eval/safety_probes/probes_reaudit.json out.jsonl [id,id]
// Output holds model text, so write it outside the repo.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
const { runTurn } = await import("../lib/agent.ts");
const { getConversation } = await import("../lib/conversations.ts");
const { setDb } = await import("../lib/db.ts");
const { loadKb } = await import("../lib/kbload.ts");
const { migrate } = await import("../lib/migrate.ts");
const { searchKb } = await import("../lib/retrieval.ts");
const { confirmBooking, whenLabel } = await import("../lib/scheduling.ts");
const { loadSeedFromSqlite } = await import("../lib/seed.ts");
const { pgliteDb } = await import("../test/pglite.ts");
const { route } = await import("../lib/policy.ts");
const { costUsd } = await import("../lib/pricing.ts");
const { config } = await import("../lib/config.ts");

const data = "/mnt/project-files/data/meridian_dataset";
const d = await pgliteDb();
setDb(d);
await migrate(d);
await loadSeedFromSqlite(d, path.join(data, "scheduling_db/meridian_scheduling.sqlite"));
console.error("kb", await loadKb(d, "/mnt/project-files/data/kb/chunks.json"));
await d.query(`INSERT INTO sessions (session_id, role, expires_at) VALUES ('probe','caller', now() + interval '1 day')`);
const deps = { db: d, anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_AEA_API_KEY }), search: (q: string) => searchKb(d, q) };

const probes: { id: string; cat: string; turns: string[] }[] = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const only = process.argv[4] ? new Set(process.argv[4].split(",")) : null;
const out = fs.createWriteStream(process.argv[3], { flags: "a" });
let totalCost = 0, tin = 0, tout = 0;
async function runOne(p: { id: string; cat: string; turns: string[] }) {
  const c = getConversation("probe", `conv_${p.id}_xxxxxx`);
  const turns: unknown[] = [];
  for (let t of p.turns) {
    if (t === "@PICK") {
      const o = [...c.offered.values()][0];
      if (!o) { turns.push({ input: t, skipped: "no slots" }); continue; }
      t = `I'll take ${whenLabel(o.date, o.window)} (slot_id ${o.slot_id}).`;
    }
    if (t === "@CONFIRM") {
      if (!c.pending) { turns.push({ input: t, skipped: "no pending" }); continue; }
      const b = await d.tx((q: any) => confirmBooking(q, c.pending!, `idem-${p.id}-${turns.length}`));
      if (b.ok) c.notes.push(`The caller pressed Confirm and the app booked it, reference ${b.ref}.`);
      turns.push({ input: t, confirm: b });
      continue;
    }
    let text = "";
    const events: unknown[] = [];
    const rt = route(t);
    let r: any;
    try {
      r = await runTurn(deps, c, t, (e: any) => {
        if (e.type === "text_delta") text += e.text;
        else if (e.type === "text_discard") text = text.slice(0, text.length - e.chars);
        else if (e.type !== "status") events.push(e.type === "safety" ? { type: "safety", script: e.script } : e);
      });
    } catch (e) { r = { outcome: "exception:" + String(e) }; }
    const cost = r.usage ? costUsd(config.model, r.usage) : 0;
    totalCost += cost; tin += r.inputTokens ?? 0; tout += r.outputTokens ?? 0;
    turns.push({ input: t, route: rt.kind === "model" ? "model" : `${rt.kind}:${(rt as any).script ?? (rt as any).reason}/${(rt as any).intent}`,
      outcome: r.outcome, safetyCheck: r.safetyCheck, handoffReason: r.handoffReason, tools: r.toolCalls, events, text, safetyLock: c.safetyLock });
  }
  out.write(JSON.stringify({ id: p.id, cat: p.cat, turns }) + "\n");
  console.error("done", p.id);
}
const queue = probes.filter((p) => !only || only.has(p.id));
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await runOne(queue.shift()!); }));
console.error(`TOTAL cost=$${totalCost.toFixed(4)} in=${tin} out=${tout} model=${config.model}`);
out.end();
await d.close();
