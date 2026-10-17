import { z } from "zod";
import { changeAppointment } from "@/lib/accounts";
import { findConversation } from "@/lib/conversations";
import { db } from "@/lib/db";
import { allow } from "@/lib/ratelimit";
import { isConstraintViolation } from "@/lib/scheduling";
import { requireSession } from "@/lib/session";
import { record } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  conversation_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  appointment_id: z.number().int(),
  action: z.enum(["cancel", "reschedule"]),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

// The only write path for changes to existing appointments. The caller pressed Confirm on a card the server created
// for a customer the server verified in this conversation.
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  const rl = allow(`confirm:${session.id}`, 10, 60_000);
  if (!rl.ok) return Response.json({ error: "rate_limited", retry_after_s: rl.retryAfterS }, { status: 429 });

  const conv = findConversation(session.id, b.conversation_id);
  const p = conv?.pendingChange;
  if (!conv || !p || !conv.verified || p.customer_id !== conv.verified.customerId || p.appointment_id !== b.appointment_id || p.action !== b.action || conv.safetyLock) {
    return Response.json({ type: "change_failed", reason: "error" }, { status: 409 });
  }
  let result;
  try {
    result = await db().tx((q) => changeAppointment(q, p, b.idempotency_key));
  } catch (e) {
    result = isConstraintViolation(e) ? ({ ok: false, reason: "slot_taken" } as const) : ({ ok: false, reason: "error" } as const);
  }
  void record({ session_id: session.id, kind: "change", outcome: result.ok ? (result.action === "cancel" ? "cancelled" : "rescheduled") : result.reason });
  if (result.ok) {
    conv.pendingChange = undefined;
    conv.steps.push(result.action === "cancel" ? "cancelled" : "rescheduled");
    conv.notes.push(result.action === "cancel"
      ? `The caller pressed Confirm and the app cancelled their ${result.service.toLowerCase()} on ${result.old_when_label}. The app already showed them this.`
      : `The caller pressed Confirm and the app moved their ${result.service.toLowerCase()} from ${result.old_when_label} to ${result.when_label}, reference ${result.ref}. The app already showed them this.`);
    return Response.json({ type: "changed", action: result.action, ref: result.ref, when_label: result.when_label, old_when_label: result.old_when_label, service: result.service });
  }
  if (result.reason === "slot_taken") conv.notes.push("The new time the caller tried to confirm was just taken. Offer to check availability again.");
  if (result.reason === "cap_reached") conv.notes.push("The caller reached the demo limit on bookings and changes per session.");
  return Response.json({ type: "change_failed", reason: result.reason }, { status: 409 });
}
