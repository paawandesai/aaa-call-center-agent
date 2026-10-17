import type { Queryable } from "./db";
import type { Conversation } from "./conversations";
import type { HandoffReason } from "./policy";
import { redact } from "./redact";

export async function createHandoff(q: Queryable, c: Conversation, reason: HandoffReason, summary: string, lastCallerText: string) {
  const slot = c.pending ? { slot_id: c.pending.slot_id, service_type: c.pending.service_type } : null;
  const callerProvided: Record<string, string> = {};
  if (c.caller.zip) callerProvided.zip = c.caller.zip;
  if (c.caller.name) callerProvided.name = c.caller.name;
  const { rows } = await q.query<{ id: number; position: number }>(
    `WITH ins AS (
       INSERT INTO handoffs (session_id, reason, intent, steps_tried, caller_provided, slot, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id)
     SELECT ins.id, (SELECT count(*)::int FROM handoffs WHERE status = 'open') + 1 AS position FROM ins`,
    [c.sessionId, reason, c.intents.at(-1) ?? null, JSON.stringify(c.steps.slice(-8)),
     JSON.stringify({ ...callerProvided, verified: !!c.verified }), slot ? JSON.stringify(slot) : null,
     `AI-written: ${summary}\nCaller's last message (redacted): ${redact(lastCallerText).slice(0, 300)}`],
  );
  return rows[0];
}

export async function openHandoffCount(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM handoffs WHERE status = 'open' AND created_at > now() - interval '7 days'`);
  return rows[0]?.n ?? 0;
}
