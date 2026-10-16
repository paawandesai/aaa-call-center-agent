import { z } from "zod";
import { findConversation } from "@/lib/conversations";
import { db } from "@/lib/db";
import { allow } from "@/lib/ratelimit";
import { confirmBooking, findSlots, isConstraintViolation, whenLabel } from "@/lib/scheduling";
import { requireSession } from "@/lib/session";
import { record } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  conversation_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  slot_id: z.number().int(),
  name: z.string().trim().min(1).max(60),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

// The only write path for bookings. The caller pressed Confirm on a card the server created.
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  const rl = allow(`confirm:${session.id}`, 10, 60_000);
  if (!rl.ok) return Response.json({ error: "rate_limited", retry_after_s: rl.retryAfterS }, { status: 429 });

  const conv = findConversation(session.id, b.conversation_id);
  const p = conv?.pending;
  if (!conv || !p || p.slot_id !== b.slot_id || p.name.toLowerCase() !== b.name.toLowerCase() || conv.safetyLock) {
    return Response.json({ type: "booking_failed", reason: "error", slots: [] }, { status: 409 });
  }

  let result;
  try {
    result = await db().tx((q) => confirmBooking(q, p, b.idempotency_key));
  } catch (e) {
    result = isConstraintViolation(e) ? ({ ok: false, reason: "slot_taken" } as const) : ({ ok: false, reason: "error" } as const);
  }
  void record({ session_id: session.id, kind: "booking", outcome: result.ok ? "booked" : result.reason });

  if (result.ok) {
    conv.pending = undefined;
    conv.steps.push("booked");
    conv.notes.push(`The caller pressed Confirm and the app booked the ${result.service.toLowerCase()} for ${result.when_label}, reference ${result.ref}. The app already showed them the booking details.`);
    return Response.json({ type: "booked", ref: result.ref, when_label: result.when_label, tz: result.tz, service: result.service, tech_first_name: result.tech_first_name });
  }
  let slots: { slot_id: number; date: string; window_label: string; tz: "America/Chicago" }[] = [];
  if (result.reason === "slot_taken") {
    const next = await findSlots(db(), { zone: p.zone, service_type: p.service_type });
    for (const s of next) conv.offered.set(s.slot_id, { slot_id: s.slot_id, zone: p.zone, zip: p.zip, city: p.city, service_type: p.service_type, date: s.date, window: s.window });
    slots = next.map((s) => ({ slot_id: s.slot_id, date: s.date, window_label: whenLabel(s.date, s.window), tz: "America/Chicago" as const }));
    conv.notes.push("The time the caller tried to confirm was just taken. The app showed new options.");
  }
  if (result.reason === "cap_reached") conv.notes.push("The caller reached the demo limit on bookings per session.");
  return Response.json({ type: "booking_failed", reason: result.reason, slots }, { status: 409 });
}
