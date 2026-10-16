import { z } from "zod";
import { runTurn } from "@/lib/agent";
import { getConversation } from "@/lib/conversations";
import { defaultDeps } from "@/lib/deps";
import { AgentEvent } from "@/lib/events";
import { addSpend, allow, overSpendCap } from "@/lib/ratelimit";
import { whenLabel } from "@/lib/scheduling";
import { maybeNightlyReset } from "@/lib/reset";
import { requireSession } from "@/lib/session";
import { record } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  conversation_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  turn_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  message: z.string().trim().min(1).max(2000).optional(),
  action: z.enum(["human", "slot_selected"]).optional(),
  slot_id: z.number().int().optional(),
});

const busy = ((globalThis as { __busy?: Set<string> }).__busy ??= new Set<string>());

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;

  for (const [key, limit, ms] of [[`chat:${session.id}`, 20, 60_000], [`chatday:${session.id}`, 300, 86_400_000]] as const) {
    const r = allow(key, limit, ms);
    if (!r.ok) void record({ session_id: session.id, kind: "rate_limit", outcome: "429" });
    if (!r.ok) return Response.json({ error: "rate_limited", retry_after_s: r.retryAfterS }, { status: 429, headers: { "Retry-After": String(r.retryAfterS) } });
  }

  await maybeNightlyReset().catch(() => {});
  const conv = getConversation(session.id, b.conversation_id);
  let text = b.message;
  if (b.action === "human") text = "I'd like to talk to a person, please.";
  if (b.action === "slot_selected") {
    const o = b.slot_id !== undefined ? conv.offered.get(b.slot_id) : undefined;
    if (!o) return Response.json({ error: "unknown_slot" }, { status: 400 });
    text = `I'll take ${whenLabel(o.date, o.window)} (slot_id ${o.slot_id}).`;
  }
  if (!text) return Response.json({ error: "bad_request" }, { status: 400 });

  const lockKey = `${session.id}:${b.conversation_id}`;
  const enc = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (e: AgentEvent) => {
        const ev = AgentEvent.parse(e); // never send an event that fails the schema
        controller.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`));
      };
      const heartbeat = setInterval(() => controller.enqueue(enc.encode(`: ping\n\n`)), 15_000);
      try {
        if (conv.turns.has(b.turn_id)) {
          write({ type: "error", code: "duplicate_turn", retryable: false });
        } else if (busy.has(lockKey)) {
          write({ type: "error", code: "turn_in_progress", retryable: true });
        } else if (overSpendCap()) {
          write({ type: "error", code: "capacity", retryable: false });
        } else {
          busy.add(lockKey);
          try {
            const r = await runTurn(defaultDeps(), conv, text!, write, req.signal);
            if (r.outcome !== "error") conv.turns.set(b.turn_id, conv.messages.length);
            addSpend(r.inputTokens, r.outputTokens);
            void record({ session_id: session.id, turn_id: b.turn_id, kind: "turn", intent: r.intent, outcome: r.outcome,
              reason: r.handoffReason, latency_ms: Date.now() - started, first_token_ms: r.firstTokenMs, input_tokens: r.inputTokens,
              output_tokens: r.outputTokens, top_score: r.topScore, meta: { tools: r.toolCalls.join(","), action: b.action ?? null, conversation: b.conversation_id } });
          } finally {
            busy.delete(lockKey);
          }
        }
        write({ type: "done", turn_id: b.turn_id, latency_ms: Date.now() - started });
      } catch {
        try { write({ type: "error", code: "server_error", retryable: true }); } catch { /* stream closed */ }
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
