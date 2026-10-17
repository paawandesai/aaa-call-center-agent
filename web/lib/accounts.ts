import type { Queryable } from "./db";
import { config, now } from "./config";
import { isSlotAvailable, SERVICE_LABEL, whenLabel, type ServiceType } from "./scheduling";
import type { Zone } from "./zones";

// Caller verification and account reads against the mock scheduling DB. A caller is verified when the phone
// number AND the ZIP code both match one customer. Every read below is scoped to that verified customer id,
// which lives only in server memory; the model never chooses whose records it sees.

export const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

export interface Verified { customerId: string; firstName: string; zip: string; zone: Zone | null }

export async function verifyCaller(q: Queryable, phone: string, zip: string): Promise<Verified | null> {
  const p = digits(phone), z = zip.trim().slice(0, 5);
  if (p.length !== 10 || !/^\d{5}$/.test(z)) return null;
  const { rows } = await q.query<{ customer_id: string; name: string; zip: string }>(
    `SELECT customer_id, name, zip FROM customers
     WHERE regexp_replace(phone, '\\D', '', 'g') = $1 AND zip = $2 AND created_by_session IS NULL`, [p, z]);
  if (rows.length !== 1) return null;
  return { customerId: rows[0].customer_id, firstName: rows[0].name.split(" ")[0], zip: rows[0].zip, zone: null };
}

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
const dateLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

export interface UpcomingAppointment { appointment_id: number; slot_id: number; date: string; window: string; service_type: ServiceType; zone: Zone; start_utc: string; issue: string | null }

export async function upcomingAppointments(q: Queryable, customerId: string): Promise<UpcomingAppointment[]> {
  const { rows } = await q.query<UpcomingAppointment>(
    `SELECT a.appointment_id::int AS appointment_id, s.slot_id, to_char(s.slot_date,'YYYY-MM-DD') AS date, s."window" AS window,
       s.service_type, s.zone, s.start_utc::text AS start_utc, a.issue_description AS issue
     FROM appointments a JOIN appointment_slots s ON s.slot_id = a.slot_id
     WHERE a.customer_id = $1 AND a.status = 'scheduled' AND s.end_utc > $2 ORDER BY s.start_utc`,
    [customerId, now().toISOString()]);
  return rows;
}

export type LookupTopic = "appointments" | "invoices" | "membership";

// What the model sees: only the verified caller's own records, formatted, with no internal customer id.
export async function lookupAccount(q: Queryable, customerId: string, topic: LookupTopic): Promise<Record<string, unknown>> {
  if (topic === "appointments") {
    const appts = await upcomingAppointments(q, customerId);
    return { upcoming_appointments: appts.map((a) => ({ appointment_id: a.appointment_id, service: SERVICE_LABEL[a.service_type],
      service_type: a.service_type, when: whenLabel(a.date, a.window), issue: a.issue })) };
  }
  if (topic === "invoices") {
    const { rows } = await q.query<{ invoice_id: string; issued: string; due: string; amount_cents: number; balance_cents: number; line_items: { desc: string; cents: number }[] }>(
      `SELECT invoice_id, to_char(issued_date,'YYYY-MM-DD') AS issued, to_char(due_date,'YYYY-MM-DD') AS due, amount_cents, balance_cents, line_items
       FROM invoices WHERE customer_id = $1 ORDER BY issued_date DESC LIMIT 6`, [customerId]);
    const total = rows.reduce((s, r) => s + r.balance_cents, 0);
    return { balance_due: money(total), invoices: rows.map((r) => ({ invoice_id: r.invoice_id, issued: dateLabel(r.issued), due: dateLabel(r.due),
      amount: money(r.amount_cents), balance: money(r.balance_cents), line_items: r.line_items.map((l) => ({ description: l.desc, amount: money(l.cents) })) })) };
  }
  const { rows } = await q.query<{ membership_tier: string; renewal: string | null }>(
    `SELECT membership_tier, to_char(membership_renewal_date,'YYYY-MM-DD') AS renewal FROM customers WHERE customer_id = $1`, [customerId]);
  const r = rows[0];
  const tier = r?.membership_tier === "plus" ? "Comfort Club Plus" : r?.membership_tier === "standard" ? "Comfort Club" : "none";
  return { membership: tier, renewal_date: r?.renewal ? dateLabel(r.renewal) : null };
}

export interface PendingChange {
  session_id: string;
  customer_id: string;
  appointment_id: number;
  action: "cancel" | "reschedule";
  new_slot_id?: number;
  service_type: ServiceType;
  zone: Zone;
}

// Cancellations or moves inside 24 hours of the window carry the $49 late fee (customer FAQ and 2026 fee schedule).
export function lateFee(startUtc: string): string | null {
  return new Date(startUtc).getTime() - now().getTime() < 24 * 3600_000 ? "$49 late-cancellation fee (less than 24 hours before the window)" : null;
}

export type ChangeResult =
  | { ok: true; action: "cancel" | "reschedule"; ref: string; when_label: string; old_when_label: string; service: string; replayed: boolean }
  | { ok: false; reason: "slot_taken" | "not_found" | "cap_reached" | "error" };

// The only code path that changes an existing appointment. One transaction; ownership and slot re-checked inside it.
export async function changeAppointment(tx: Queryable, p: PendingChange, idempotencyKey: string): Promise<ChangeResult> {
  const prior = await tx.query<{ appointment_id: number; booking_ref: string; date: string; window: string }>(
    `SELECT a.appointment_id::int AS appointment_id, a.booking_ref, to_char(s.slot_date,'YYYY-MM-DD') AS date, s."window" AS window
     FROM appointments a JOIN appointment_slots s ON s.slot_id = a.slot_id WHERE a.idempotency_key = $1 AND a.booked_by_session = $2`,
    [idempotencyKey, p.session_id]);
  const old = await tx.query<{ status: string; slot_id: number; date: string; window: string; start_utc: string; issue: string | null; is_warranty_visit: boolean }>(
    `SELECT a.status, a.slot_id, to_char(s.slot_date,'YYYY-MM-DD') AS date, s."window" AS window, s.start_utc::text AS start_utc,
       a.issue_description AS issue, a.is_warranty_visit
     FROM appointments a JOIN appointment_slots s ON s.slot_id = a.slot_id
     WHERE a.appointment_id = $1 AND a.customer_id = $2 FOR UPDATE OF a`, [p.appointment_id, p.customer_id]);
  const o = old.rows[0];
  if (!o) return { ok: false, reason: "not_found" };
  const service = SERVICE_LABEL[p.service_type];
  if (prior.rows[0]) {
    const r = prior.rows[0];
    return { ok: true, replayed: true, action: p.action, ref: r.booking_ref, when_label: whenLabel(r.date, r.window), old_when_label: whenLabel(o.date, o.window), service };
  }
  if (o.status === "cancelled" && p.action === "cancel") {
    return { ok: true, replayed: true, action: "cancel", ref: `MHC-A${p.appointment_id}`, when_label: whenLabel(o.date, o.window), old_when_label: whenLabel(o.date, o.window), service };
  }
  if (o.status !== "scheduled" || new Date(o.start_utc).getTime() <= now().getTime()) return { ok: false, reason: "not_found" };

  const sess = await tx.query<{ bookings_made: number }>(`SELECT bookings_made FROM sessions WHERE session_id = $1 FOR UPDATE`, [p.session_id]);
  if (!sess.rows[0]) return { ok: false, reason: "error" };
  // Cancelling frees a slot, so only reschedules count toward the cap.
  if (p.action !== "cancel" && sess.rows[0].bookings_made >= config.bookingsPerSession) return { ok: false, reason: "cap_reached" };

  let ref = `MHC-A${p.appointment_id}`;
  let when = whenLabel(o.date, o.window);
  if (p.action === "reschedule") {
    const slotRow = await tx.query<{ tech_id: number }>(`SELECT tech_id FROM appointment_slots WHERE slot_id = $1 FOR UPDATE`, [p.new_slot_id]);
    if (!slotRow.rows[0]) return { ok: false, reason: "slot_taken" };
    await tx.query(`SELECT 1 FROM technicians WHERE tech_id = $1 FOR UPDATE`, [slotRow.rows[0].tech_id]);
    const slot = await isSlotAvailable(tx, p.new_slot_id!, p.zone, p.service_type);
    if (!slot) return { ok: false, reason: "slot_taken" };
    ref = `MHC-R${p.appointment_id}-${slot.slot_id}`;
    when = whenLabel(slot.date, slot.window);
    await tx.query(`UPDATE appointments SET status = 'cancelled' WHERE appointment_id = $1`, [p.appointment_id]);
    await tx.query(`INSERT INTO appointments (slot_id, customer_id, issue_description, booked_by_session, idempotency_key, booking_ref, is_warranty_visit)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [slot.slot_id, p.customer_id, o.issue, p.session_id, idempotencyKey, ref, o.is_warranty_visit]);
    await tx.query(`UPDATE appointment_slots SET status = 'booked' WHERE slot_id = $1`, [slot.slot_id]);
  } else {
    await tx.query(`UPDATE appointments SET status = 'cancelled' WHERE appointment_id = $1`, [p.appointment_id]);
  }
  // The old slot opens again only if no other live appointment holds it.
  await tx.query(`UPDATE appointment_slots SET status = 'open' WHERE slot_id = $1 AND status = 'booked'
    AND NOT EXISTS (SELECT 1 FROM appointments WHERE slot_id = $1 AND status = 'scheduled')`, [o.slot_id]);
  if (p.action !== "cancel") await tx.query(`UPDATE sessions SET bookings_made = bookings_made + 1 WHERE session_id = $1`, [p.session_id]);
  return { ok: true, replayed: false, action: p.action, ref, when_label: when, old_when_label: whenLabel(o.date, o.window), service };
}

// The synthetic RAIL- customers (lib/seed.ts) shown in the chat rail so visitors can try account features. Partner
// customers are never listed.
export async function demoIdentities(q: Queryable, n = 3): Promise<{ first_name: string; phone: string; zip: string; has: string }[]> {
  const { rows } = await q.query<{ name: string; phone: string; zip: string; appts: number; bal: number }>(
    `SELECT c.name, c.phone, c.zip,
       (SELECT count(*)::int FROM appointments a JOIN appointment_slots s ON s.slot_id = a.slot_id
          WHERE a.customer_id = c.customer_id AND a.status = 'scheduled' AND s.start_utc > $1::timestamptz + interval '1 day') AS appts,
       (SELECT coalesce(sum(balance_cents),0)::int FROM invoices i WHERE i.customer_id = c.customer_id) AS bal
     FROM customers c WHERE c.customer_id LIKE 'RAIL-%' ORDER BY c.customer_id`, [now().toISOString()]);
  const pick = rows.filter((r) => r.appts > 0 && r.bal > 0).slice(0, n);
  return pick.map((r) => ({ first_name: r.name.split(" ")[0], phone: r.phone, zip: r.zip, has: "an upcoming visit and an open invoice" }));
}
