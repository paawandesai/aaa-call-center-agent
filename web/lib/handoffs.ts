import type { Queryable } from "./db";
import type { Conversation } from "./conversations";
import type { HandoffReason } from "./policy";
import { allow } from "./ratelimit";
import { redact } from "./redact";

// A safety phrase creates a handoff without a model call, so it costs nothing and the spend cap never applies. To keep one
// visitor from burying real emergencies in the queue, a second handoff for the same reason from the same session within a
// day is added to the open ticket (staff see both summaries) instead of making a new row. Non-safety tickets are also
// capped at five per IP bucket a day; over that the caller is told it wasn't queued. Safety tickets are never dropped.
const PER_IP_DAY = 5;
const MAX_SUMMARY = 4000;

export type HandoffResult = { id: number; position: number } | { suppressed: true };

export async function createHandoff(q: Queryable, c: Conversation, reason: HandoffReason, summary: string, lastCallerText: string,
  source: "model" | "policy" = "model"): Promise<HandoffResult> {
  // One line each, so neither the model's summary nor the caller's words can forge the separators the staff page splits on.
  const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ");
  const text = `${source === "model" ? "AI-written: " : ""}${oneLine(redact(summary))}\nCaller's last message (redacted): ${oneLine(redact(lastCallerText)).slice(0, 300)}`;
  const { rows: open } = await q.query<{ id: number; position: number }>(
    `UPDATE handoffs h SET summary = left(h.summary || E'\n---\nLater, in the same session:\n' || $3, $4)
     WHERE h.id = (SELECT id FROM handoffs WHERE session_id = $1 AND reason = $2 AND status = 'open' AND created_at > now() - interval '1 day'
                   ORDER BY created_at DESC LIMIT 1)
     RETURNING h.id::int AS id, (SELECT count(*)::int FROM handoffs o WHERE o.status = 'open' AND o.created_at <= h.created_at) AS position`,
    [c.sessionId, reason, text, MAX_SUMMARY]);
  if (open[0]) return open[0];
  // Safety and threat tickets are never dropped.
  if (reason !== "safety" && reason !== "adversarial" && c.clientIp && !allow(`handoffip:${c.clientIp}`, PER_IP_DAY, 86_400_000).ok) return { suppressed: true };
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
     JSON.stringify({ ...callerProvided, verified: !!c.verified }), slot ? JSON.stringify(slot) : null, text],
  );
  return rows[0];
}

export async function openHandoffCount(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM handoffs WHERE status = 'open' AND created_at > now() - interval '7 days'`);
  return rows[0]?.n ?? 0;
}
