// Containment eval: September holdout (redacted openings, deterministic gold) + synthetic adversarial set,
// plus retrieval re-evaluated through the app's own pgvector query. Real model calls (ANTHROPIC_AEA_API_KEY).
//   npx tsx scripts/run_eval.ts [--limit N] [--only holdout|adversarial]
import Anthropic from "@anthropic-ai/sdk";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runTurn } from "../lib/agent";
import { config } from "../lib/config";
import { getConversation } from "../lib/conversations";
import { setDb } from "../lib/db";
import type { AgentEvent } from "../lib/events";
import { loadKb } from "../lib/kbload";
import { migrate } from "../lib/migrate";
import { SYSTEM_PROMPT } from "../lib/prompt";
import { searchKb } from "../lib/retrieval";
import { confirmBooking, findSlots, whenLabel, type ServiceType } from "../lib/scheduling";
import { loadSeedFromSqlite } from "../lib/seed";
import { zipLookup } from "../lib/zones";
import { pgliteDb } from "../test/pglite";

process.env.DEMO_NOW ??= "2026-10-16T15:00:00Z";
const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "";
const REPO = path.resolve(process.cwd(), "..");
const DATA = process.env.MERIDIAN_DATA_DIR ?? "/mnt/project-files/data/meridian_dataset";
const EVAL_DIR = process.env.MERIDIAN_EVAL_DIR ?? "/mnt/project-files/data/eval";

type Outcome = "safety" | "handoff" | "booked" | "answered" | "confirm_pending" | "error";
interface Trace { outcome: Outcome; reason?: string; texts: string[]; events: AgentEvent[]; booked?: { service: string }; inTok: number; outTok: number; turns: number; offered: Set<number>; pendingSlot?: number }

const wilson = (k: number, n: number): [number, number] => {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const rate = (k: number, n: number) => ({ k, n, rate: n ? k / n : 0, ci: wilson(k, n) });
const rx = (s: string) => new RegExp(s, "i");

const d = await pgliteDb();
setDb(d);
await migrate(d);
await loadSeedFromSqlite(d, path.join(DATA, "scheduling_db/meridian_scheduling.sqlite"));
await loadKb(d, process.env.KB_CHUNKS ?? "/mnt/project-files/data/kb/chunks.json");
const deps = { db: d, anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_AEA_API_KEY, maxRetries: 4 }), search: (q: string) => searchKb(d, q) };

const SERVICE_OF: Record<string, ServiceType> = { "Heating or cooling repair": "hvac_repair", "Seasonal tune-up": "hvac_tune_up", "Plumbing visit": "plumbing", "Replacement estimate": "estimate" };

async function converse(id: string, turns: string[], sim?: { zip: string; opening: string }): Promise<Trace> {
  await d.query(`INSERT INTO sessions (session_id, role, expires_at) VALUES ($1,'caller', now() + interval '1 day') ON CONFLICT DO NOTHING`, [`eval-${id}`]);
  const c = getConversation(`eval-${id}`, `case-${id}`);
  const t: Trace = { outcome: "answered", texts: [], events: [], inTok: 0, outTok: 0, turns: 0, offered: new Set() };
  const queue = [...turns];
  for (let i = 0; i < 7; i++) {
    let text = queue.shift();
    const last = t.events.slice(-12);
    const lastText = t.texts.at(-1) ?? "";
    if (!text && sim) {
      const slots = [...last].reverse().find((e) => e.type === "slots" || e.type === "booking_failed") as Extract<AgentEvent, { type: "slots" }> | undefined;
      if (slots && slots.slots.length && !t.pendingSlot) {
        const s = slots.slots[0];
        const o = c.offered.get(s.slot_id)!;
        text = `I'll take ${whenLabel(o.date, o.window)} (slot_id ${s.slot_id}).`;
        t.pendingSlot = s.slot_id;
      } else if (/zip/i.test(lastText)) text = sim.zip;
      else if (/\bname\b/i.test(lastText)) text = "Test Caller";
      else if (/\?\s*$/.test(lastText.trim()) && /(book|schedule|visit|appointment|come out|time)/i.test(lastText)) text = `Yes, please. My ZIP is ${sim.zip}.`;
      else if (/\?\s*$/.test(lastText.trim())) text = "Could you just help me with what I asked?";
    }
    if (!text) break;
    t.turns++;
    let reply = "";
    const r = await runTurn(deps, c, text, (e) => { if (e.type === "text_delta") reply += e.text; else t.events.push(e); });
    t.texts.push(reply);
    t.inTok += r.inputTokens; t.outTok += r.outputTokens;
    for (const s of c.offered.keys()) t.offered.add(s);
    if (r.outcome === "error") { t.outcome = "error"; return t; }
    if (r.outcome === "safety") { t.outcome = "safety"; t.reason = "safety"; return t; }
    if (r.outcome === "handoff") { t.outcome = "handoff"; t.reason = r.handoffReason; return t; }
    if (r.outcome === "confirm_shown" && c.pending) {
      if (!sim && queue.length) { t.outcome = "confirm_pending"; continue; }
      const b = await d.tx((q) => confirmBooking(q, c.pending!, randomBytes(8).toString("hex")));
      if (b.ok) {
        c.notes.push(`The caller pressed Confirm and the app booked it, reference ${b.ref}.`);
        t.outcome = "booked"; t.booked = { service: b.service }; return t;
      }
      t.events.push({ type: "booking_failed", reason: b.reason, slots: [] });
    }
  }
  if (t.events.some((e) => e.type === "confirm_request") && t.outcome !== "booked") t.outcome = "confirm_pending";
  return t;
}

const FALSE_BOOKING = rx(String.raw`\b(you'?re|you are|i'?ve|i have|it'?s|is now|has been)\s+(all\s+)?(booked|scheduled|confirmed)\b`);

// ---------- holdout ----------
const out: Record<string, unknown> = {};
const caseLog: unknown[] = [];
let inTok = 0, outTok = 0;
if (only !== "adversarial") {
  const H = JSON.parse(readFileSync(path.join(EVAL_DIR, "holdout_cases.json"), "utf8")) as {
    forbidden: string[]; forbidden_membership: string[];
    cases: { id: string; driver: string; intent: string; opening: string; zip: string; expected: { outcome: string; services?: string[]; required?: string[] } }[];
  };
  const cases = H.cases.slice(0, limit);
  const rows: { id: string; driver: string; expected: string; got: string; contained: boolean; correct: boolean; checks: string[]; escalateExpected: boolean; escalated: boolean; inScope: boolean }[] = [];
  let done = 0;
  const work = async (k: (typeof cases)[number]) => {
    let exp = k.expected.outcome;
    // A booking case whose zone has no openings for that service is correctly a handoff (coverage gap).
    if (exp === "booked") {
      const z = zipLookup(k.zip);
      const avail = z.kind === "zone" ? await findSlots(d, { zone: z.zone, service_type: k.expected.services![0] as ServiceType }) : [];
      if (!avail.length) exp = "handoff";
    }
    const t = await converse(k.id, [k.opening], { zip: k.zip, opening: k.opening });
    inTok += t.inTok; outTok += t.outTok;
    const all = t.texts.join("\n");
    const checks: string[] = [];
    const forb = [...H.forbidden, ...(k.intent.startsWith("membership") ? H.forbidden_membership : [])];
    for (const f of forb) if (rx(f).test(all)) checks.push(`forbidden stale value /${f}/`);
    if (t.outcome !== "booked" && FALSE_BOOKING.test(all)) checks.push("claimed a booking without a DB write");
    let correct = false;
    if (exp === "safety") correct = t.outcome === "safety";
    else if (exp === "handoff") correct = t.outcome === "handoff" || t.outcome === "safety";
    else if (exp === "booked") {
      correct = t.outcome === "booked" && k.expected.services!.includes(SERVICE_OF[t.booked!.service]);
      if (t.outcome === "booked" && !correct) checks.push(`booked wrong service (${t.booked!.service})`);
      if (t.outcome !== "booked") checks.push(`expected a booking, got ${t.outcome}${t.reason ? ` (${t.reason})` : ""}`);
    } else if (exp === "answered") {
      const req = k.expected.required ?? [];
      const hasFact = !req.length || req.some((r) => rx(r).test(all));
      if (!hasFact) checks.push("required fact missing");
      if (t.outcome !== "answered") checks.push(`expected an answer, got ${t.outcome}${t.reason ? ` (${t.reason})` : ""}`);
      correct = t.outcome === "answered" && hasFact;
    }
    if (exp === "handoff" && !correct) checks.push(`expected a handoff, got ${t.outcome}`);
    if (exp === "safety" && !correct) checks.push(`expected the safety script, got ${t.outcome}`);
    if (checks.some((c) => c.startsWith("forbidden") || c.startsWith("claimed"))) correct = false;
    const contained = t.outcome === "booked" || t.outcome === "answered";
    rows.push({ id: k.id, driver: k.driver, expected: exp, got: t.outcome + (t.reason ? `:${t.reason}` : ""), contained, correct, checks,
      escalateExpected: exp === "handoff" || exp === "safety", escalated: t.outcome === "handoff" || t.outcome === "safety",
      inScope: exp === "booked" || exp === "answered" });
    caseLog.push({ set: "holdout", id: k.id, intent: k.intent, expected: exp, outcome: t.outcome, reason: t.reason, checks, turns: t.turns, texts: t.texts });
    if (++done % 10 === 0) console.log(`holdout ${done}/${cases.length} tokens in=${inTok} out=${outTok}`);
  };
  const pool = [...cases];
  await Promise.all(Array.from({ length: 4 }, async () => { while (pool.length) await work(pool.shift()!); }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const n = rows.length;
  const verified = rows.filter((r) => r.contained && r.correct).length;
  const handled = rows.filter((r) => r.inScope);
  const esc = rows.filter((r) => r.escalated), escExp = rows.filter((r) => r.escalateExpected);
  const drivers = [...new Set(rows.map((r) => r.driver))].sort();
  out.holdout = {
    n,
    containment: rate(verified, n),
    contained_any: rate(rows.filter((r) => r.contained).length, n),
    ceiling: rate(handled.length, n),
    accuracy: rate(handled.filter((r) => r.correct).length, handled.length),
    escalation: { precision: rate(esc.filter((r) => r.escalateExpected).length, esc.length), recall: rate(escExp.filter((r) => r.escalated).length, escExp.length) },
    safety: rate(rows.filter((r) => r.expected === "safety" && r.got === "safety").length, rows.filter((r) => r.expected === "safety").length),
    per_driver: drivers.map((dr) => {
      const rs = rows.filter((r) => r.driver === dr);
      return { driver: dr, n: rs.length, contained: rs.filter((r) => r.contained && r.correct).length, correct: rs.filter((r) => r.correct).length, failed: rs.filter((r) => !r.correct).map((r) => r.id) };
    }),
    failures: rows.filter((r) => !r.correct || (r.contained && r.checks.length)).map((r) => ({ id: r.id, driver: r.driver, expected: r.expected, got: r.got, checks: r.checks })),
  };
}

// ---------- adversarial ----------
if (only !== "holdout") {
  const A = JSON.parse(readFileSync(path.join(REPO, "eval/adversarial/cases.json"), "utf8")) as { cases: {
    id: string; turns: string[]; required?: string[]; forbidden?: string[]; no_booking?: boolean; no_unoffered_booking?: boolean;
    expect_outcome?: string[]; expect_reason?: string[]; synthetic_probe?: boolean }[] };
  const res: { id: string; pass: boolean; outcome: string; checks: string[]; probe: boolean }[] = [];
  for (const k of A.cases.slice(0, limit)) {
    const before = (await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM appointments`)).rows[0].n;
    const t = await converse(k.id, k.turns);
    inTok += t.inTok; outTok += t.outTok;
    const all = t.texts.join("\n") + "\n" + t.events.filter((e) => e.type === "safety").map((e) => (e as { text: string }).text).join("\n");
    const after = (await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM appointments`)).rows[0].n;
    const checks: string[] = [];
    for (const r of k.required ?? []) if (!rx(r).test(all)) checks.push(`missing /${r}/`);
    for (const f of k.forbidden ?? []) if (rx(f).test(all)) checks.push(`forbidden /${f}/`);
    if (k.no_booking && (after !== before || t.events.some((e) => e.type === "confirm_request"))) checks.push("booking flow started");
    if (k.no_unoffered_booking && t.pendingSlot === undefined && t.events.some((e) => e.type === "confirm_request" && !t.offered.has((e as { slot_id: number }).slot_id))) checks.push("confirm card for a slot that was never offered");
    if (k.expect_outcome && !k.expect_outcome.includes(t.outcome)) checks.push(`outcome ${t.outcome}`);
    if (k.expect_reason && !k.expect_reason.includes(t.reason ?? "")) checks.push(`reason ${t.reason ?? "none"}`);
    if (t.outcome === "error") checks.push("error");
    res.push({ id: k.id, pass: checks.length === 0, outcome: t.outcome + (t.reason ? `:${t.reason}` : ""), checks, probe: Boolean(k.synthetic_probe) });
    caseLog.push({ set: "adversarial", id: k.id, outcome: t.outcome, reason: t.reason, checks, texts: t.texts });
    console.log(`${k.id}: ${checks.length ? "FAIL " + checks.join("; ") : "pass"}`);
  }
  const adv = res.filter((r) => !r.probe), probes = res.filter((r) => r.probe);
  out.adversarial = { result: rate(adv.filter((r) => r.pass).length, adv.length), probes: rate(probes.filter((r) => r.pass).length, probes.length), cases: res };
}

// ---------- retrieval through the app's pgvector query ----------
const R = JSON.parse(readFileSync(path.join(REPO, "eval/retrieval_dev.json"), "utf8")) as { items: { q: string; gold: [string, string][] }[] };
let hits = 0, mrr = 0;
for (const it of R.items) {
  const top = await searchKb(d, it.q, 5);
  const rank = top.findIndex((c) => it.gold.some(([doc, m]) => c.doc === doc && c.text.toLowerCase().includes(m.toLowerCase())));
  if (rank >= 0) { hits++; mrr += 1 / (rank + 1); }
}
out.retrieval = { hit5: rate(hits, R.items.length), mrr: mrr / R.items.length, where: "app query on pgvector (PGlite), dev set" };

const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13) + "-" + randomBytes(2).toString("hex");
const configId = createHash("sha256").update(JSON.stringify([config.model, config.effort, config.maxTokens, SYSTEM_PROMPT])).digest("hex").slice(0, 10);
const cost = (inTok * 4 + outTok * 20) / 1e6;
const summary = { run_id: runId, created_at: new Date().toISOString(), config_id: configId, prompt_version: config.promptVersion, demo_now: process.env.DEMO_NOW,
  tokens: { input: inTok, output: outTok, est_cost_usd: Number(cost.toFixed(2)) }, ...out };
mkdirSync(EVAL_DIR, { recursive: true });
writeFileSync(path.join(EVAL_DIR, `run_${runId}.json`), JSON.stringify({ summary, cases: caseLog }, null, 1)); // contains model text: kept outside the repo
if (!Number.isFinite(limit) && !only) writeFileSync(path.join(REPO, "eval/results/containment_holdout.json"), JSON.stringify(summary, null, 1) + "\n");
console.log(JSON.stringify(summary, (k, v) => (k === "cases" || k === "per_driver" ? undefined : v), 1));
await d.close();
