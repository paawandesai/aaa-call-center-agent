import { randomBytes } from "node:crypto";
import type { Queryable } from "./db";

// Synthetic staff-console activity for the demo, so the dashboard, handoff queue and review queue have something to show
// before real traffic arrives. Every row is made up, carries a "demo_" session id (and meta.demo on events), and is
// regenerated over the last 7 days on each deploy and nightly reset. No caller text exists in any of it.
export const DEMO_PREFIX = "demo_";

// Mix taken from the eval's driver shares: roughly 40% contained, the rest handed off by reason.
const OUTCOMES: [string, string | null, string | null, number][] = [
  ["answered", null, "membership_info", 8], ["answered", null, "warranty_coverage", 5], ["answered", null, "fees", 6],
  ["booked", null, "repair_booking", 12], ["booked", null, "tune_up", 4],
  ["handoff", "billing_account", "billing", 21], ["handoff", "cancel_reschedule", "cancel_reschedule", 9],
  ["handoff", "human_requested", "human_requested", 6], ["safety", "safety", "burning_smell", 3], ["safety", "safety", "gas_leak", 2],
  ["handoff", "complaint", "complaint", 4], ["handoff", "low_confidence", null, 3], ["handoff", "service_area_unclear", null, 2],
];

// Waiting handoffs for the queue. Summaries are invented and contain no personal details.
const HANDOFFS: { reason: string; intent: string | null; mins: number; status: string; steps: string[]; caller: Record<string, string>; summary: string; excerpt: string }[] = [
  { reason: "safety", intent: "burning_smell", mins: 3, status: "open", steps: [], caller: {}, summary: "Routed by policy (burning_smell). Safety script shown.", excerpt: "theres a burning smell from the furnace when it kicks on" },
  { reason: "billing_account", intent: "billing", mins: 11, status: "open", steps: [], caller: { name: "Demo Caller" }, summary: "Caller says their last invoice is higher than the quote and wants it reviewed.", excerpt: "my invoice [INVOICE_ID] is way more than I was quoted" },
  { reason: "service_area_unclear", intent: null, mins: 18, status: "open", steps: ["check_availability", "handoff"], caller: { zip: "78734" }, summary: "Caller wants a tune-up in Lakeway; service-area documents disagree, so coverage needs a person.", excerpt: "can you send someone to lakeway for a tune up next week" },
  { reason: "human_requested", intent: "human_requested", mins: 26, status: "open", steps: [], caller: {}, summary: "Caller asked for a person right away.", excerpt: "just let me talk to a real person please" },
  { reason: "cancel_reschedule", intent: "cancel_reschedule", mins: 41, status: "claimed", steps: [], caller: { name: "Demo Caller" }, summary: "Caller wants to move Thursday's visit to next week.", excerpt: "I need to move my appointment on thursday" },
  { reason: "low_confidence", intent: null, mins: 63, status: "open", steps: ["search_kb", "handoff"], caller: {}, summary: "Caller asked whether Meridian installs whole-home generators; the knowledge base doesn't say.", excerpt: "do you guys install generators" },
  { reason: "complaint", intent: "complaint", mins: 180, status: "resolved", steps: [], caller: {}, summary: "Caller unhappy that the technician arrived late; wants a callback from a manager.", excerpt: "the tech showed up two hours late" },
];

function rng(seed: number) {
  // mulberry32: small and well mixed, so consecutive draws don't correlate.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export async function seedDemoActivity(q: Queryable, now = new Date()) {
  await q.query(`DELETE FROM events WHERE session_id LIKE 'demo\\_%'`);
  await q.query(`DELETE FROM feedback WHERE session_id LIKE 'demo\\_%'`);
  await q.query(`DELETE FROM staff_flags WHERE handoff_id IN (SELECT id FROM handoffs WHERE session_id LIKE 'demo\\_%')`);
  await q.query(`DELETE FROM handoffs WHERE session_id LIKE 'demo\\_%'`);
  const r = rng(Math.floor(now.getTime() / 86_400_000));
  const total = OUTCOMES.reduce((a, o) => a + o[3], 0);
  const pick = () => { let x = r() * total; for (const o of OUTCOMES) if ((x -= o[3]) < 0) return o; return OUTCOMES[0]; };
  const rows: unknown[][] = [];
  const downTurns: [string, string, Date][] = [];
  for (let day = 6; day >= 0; day--) {
    const convs = 14 + Math.floor(r() * 12) - (day === 0 ? 8 : 0);
    for (let i = 0; i < convs; i++) {
      const [outcome, reason, intent] = pick();
      const session = `${DEMO_PREFIX}${randomBytes(6).toString("hex")}`;
      const conversation = `${DEMO_PREFIX}c${randomBytes(6).toString("hex")}`;
      const start = new Date(now.getTime() - day * 86_400_000 - Math.floor(r() * 10 * 3600_000) - 60_000);
      const turns = outcome === "booked" ? 3 + Math.floor(r() * 2) : outcome === "answered" ? 1 + Math.floor(r() * 2) : 1;
      for (let t = 0; t < turns; t++) {
        const last = t === turns - 1;
        const turnOutcome = last ? (outcome === "booked" ? "confirm_shown" : outcome) : t === 1 && outcome === "booked" ? "slots_offered" : "answered";
        const policy = outcome === "safety" || (outcome === "handoff" && reason !== "low_confidence" && reason !== "service_area_unclear");
        const ttft = policy && last ? null : Math.round(1200 + r() * 2600);
        const turnId = `${DEMO_PREFIX}t${randomBytes(6).toString("hex")}`;
        rows.push([new Date(start.getTime() + t * 45_000), session, turnId, "turn", intent, turnOutcome, last ? reason : null,
          (ttft ?? 40) + Math.round(r() * 1500), ttft, policy && last ? 0 : 3200, policy && last ? 0 : 140,
          policy && last ? null : 0.6 + r() * 0.3, JSON.stringify({ demo: true, conversation, tools: turnOutcome === "slots_offered" ? "check_availability" : "" })]);
        if (outcome === "answered" && last && r() < 0.12) downTurns.push([session, turnId, start]);
      }
      if (outcome === "booked") rows.push([new Date(start.getTime() + turns * 45_000), session, null, "booking", null, r() < 0.06 ? "slot_taken" : "booked", null, null, null, null, null, null, JSON.stringify({ demo: true })]);
    }
  }
  if (rows.length < 5) return { events: 0, handoffs: 0 };
  // A model error and a rate-limit hit so "Recent failures" shows each kind.
  rows.push([new Date(now.getTime() - 5 * 3600_000), `${DEMO_PREFIX}err`, `${DEMO_PREFIX}terr`, "turn", null, "error", null, 30_000, null, 3000, 0, null, JSON.stringify({ demo: true, conversation: `${DEMO_PREFIX}cerr` })]);
  rows.push([new Date(now.getTime() - 26 * 3600_000), `${DEMO_PREFIX}rl`, null, "rate_limit", null, "429", null, null, null, null, null, null, JSON.stringify({ demo: true })]);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = chunk.map((_, j) => `(${Array.from({ length: 13 }, (_, k) => `$${j * 13 + k + 1}`).join(",")})`).join(",");
    await q.query(`INSERT INTO events (ts, session_id, turn_id, kind, intent, outcome, reason, latency_ms, first_token_ms, input_tokens, output_tokens, top_score, meta) VALUES ${values}`, chunk.flat());
  }
  for (const [session, turnId, ts] of downTurns.slice(0, 3)) {
    await q.query(`INSERT INTO feedback (created_at, session_id, turn_id, rating) VALUES ($1,$2,$3,'down') ON CONFLICT DO NOTHING`, [ts, session, turnId]);
  }
  const ids: number[] = [];
  for (const h of HANDOFFS) {
    const { rows: ins } = await q.query<{ id: number }>(
      `INSERT INTO handoffs (created_at, session_id, reason, intent, steps_tried, caller_provided, summary, status, resolution)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::int AS id`,
      [new Date(now.getTime() - h.mins * 60_000), `${DEMO_PREFIX}${randomBytes(6).toString("hex")}`, h.reason, h.intent, JSON.stringify(h.steps),
        JSON.stringify({ ...h.caller, verified: false }), `AI-written: ${h.summary}\nCaller's last message (redacted): ${h.excerpt}`, h.status,
        h.status === "resolved" ? "resolved_by_staff" : null]);
    ids.push(ins[0].id);
  }
  await q.query(`INSERT INTO staff_flags (created_at, handoff_id, flag) VALUES ($1, $2, 'could_have_answered') ON CONFLICT DO NOTHING`, [new Date(now.getTime() - 50 * 60_000), ids[5]]);
  return { events: rows.length, handoffs: ids.length };
}
