import type { Queryable } from "./db";
import type { Conversation } from "./conversations";
import type { HandoffReason } from "./policy";
import { allow } from "./ratelimit";
import { redact } from "./redact";

// A safety phrase creates a handoff without a model call, so it costs nothing and the spend cap never applies. To keep one
// visitor from burying real emergencies in the queue, a session gets one open ticket per reason a day, and an IP five tickets
// a day. Over the limit no row is written, but the caller still sees the script and the handoff card.
const PER_IP_DAY = 5;

export async function createHandoff(q: Queryable, c: Conversation, reason: HandoffReason, summary: string, lastCallerText: string,
  source: "model" | "policy" = "model") {
  const { rows: open } = await q.query<{ id: number; position: number }>(
    `SELECT h.id, (SELECT count(*)::int FROM handoffs o WHERE o.status = 'open' AND o.created_at <= h.created_at) AS position
     FROM handoffs h WHERE h.session_id = $1 AND h.reason = $2 AND h.status = 'open' AND h.created_at > now() - interval '1 day'
     ORDER BY h.created_at DESC LIMIT 1`, [c.sessionId, reason]);
  if (open[0]) return open[0];
  if (c.clientIp && !allow(`handoffip:${c.clientIp}`, PER_IP_DAY, 86_400_000).ok) return undefined;
  const slot = c.pending ? { slot_id: c.pending.slot_id, service_type: c.pending.service_type }
    : c.bookedRefs?.length ? { booked_refs: c.bookedRefs } : null;
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
     `${source === "model" ? "AI-written: " : ""}${redact(summary)}\nCaller's last message (redacted): ${redact(lastCallerText).slice(0, 300)}`],
  );
  return rows[0];
}

export async function openHandoffCount(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM handoffs WHERE status = 'open' AND created_at > now() - interval '7 days'`);
  return rows[0]?.n ?? 0;
}
