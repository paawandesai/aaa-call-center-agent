import { randomBytes } from "node:crypto";
import type { Queryable } from "./db";
import { config, now } from "./config";
import type { Zone } from "./zones";

export type ServiceType = "hvac_repair" | "hvac_tune_up" | "plumbing" | "estimate";
export const SERVICE_LABEL: Record<ServiceType, string> = {
  hvac_repair: "Heating or cooling repair",
  hvac_tune_up: "Seasonal tune-up",
  plumbing: "Plumbing visit",
  estimate: "Replacement estimate",
};
// From the 2026 fee schedule and service catalog. Callers are unverified, so non-member prices are shown.
export const FEE_LABEL: Record<ServiceType, string> = {
  hvac_repair: "$89 diagnostic visit, credited toward the repair (waived for Comfort Club members)",
  hvac_tune_up: "$129 per system (included for Comfort Club members)",
  plumbing: "$89 diagnostic visit (waived for Comfort Club members)",
  estimate: "Free in-home estimate",
};
// Holiday closures from the 2026 holiday hours notice. No regular appointments on these dates.
const CLOSED_DATES = ["2026-11-26", "2026-11-27", "2026-12-25", "2027-01-01"];
const LEAD_MINUTES = 120;

export interface Slot {
  slot_id: number;
  date: string; // YYYY-MM-DD, Central
  window: string;
  start_utc: string;
  end_utc: string;
  tech_id: number;
}

const WINDOW_LABEL: Record<string, string> = {
  "08:00-12:00": "8 am to 12 pm",
  "12:00-16:00": "12 pm to 4 pm",
  "13:00-17:00": "1 pm to 5 pm",
  "16:00-19:00": "4 pm to 7 pm",
};

export function whenLabel(date: string, window: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
  return `${day}, ${WINDOW_LABEL[window] ?? window} Central`;
}

// A slot is available only if its own row is open AND the technician has no scheduled appointment
// or blocked slot overlapping the same time range (audit F1: sibling rows and 12-16 vs 13-17).
const AVAILABLE = `
  s.status = 'open'
  AND s.start_utc > $1
  AND NOT (to_char(s.slot_date, 'YYYY-MM-DD') = ANY($2::text[]))
  AND NOT EXISTS (
    SELECT 1 FROM appointments a JOIN appointment_slots o ON o.slot_id = a.slot_id
    WHERE a.status = 'scheduled' AND o.tech_id = s.tech_id
      AND tstzrange(o.start_utc, o.end_utc) && tstzrange(s.start_utc, s.end_utc))
  AND NOT EXISTS (
    SELECT 1 FROM appointment_slots o
    WHERE o.status = 'blocked' AND o.tech_id = s.tech_id AND o.slot_id <> s.slot_id
      AND tstzrange(o.start_utc, o.end_utc) && tstzrange(s.start_utc, s.end_utc))`;

const SLOT_COLS = `s.slot_id, to_char(s.slot_date, 'YYYY-MM-DD') AS date, s."window" AS window,
  s.start_utc::text AS start_utc, s.end_utc::text AS end_utc, s.tech_id`;

export async function findSlots(
  q: Queryable,
  args: { zone: Zone; service_type: ServiceType; on_or_after?: string; part_of_day?: "morning" | "afternoon" | "evening" | "any" },
): Promise<Slot[]> {
  const earliest = new Date(now().getTime() + LEAD_MINUTES * 60_000).toISOString();
  const from = args.on_or_after && /^\d{4}-\d{2}-\d{2}$/.test(args.on_or_after) ? args.on_or_after : "1970-01-01";
  const windows =
    args.part_of_day === "morning" ? ["08:00-12:00"]
    : args.part_of_day === "afternoon" ? ["12:00-16:00", "13:00-17:00"]
    : args.part_of_day === "evening" ? ["16:00-19:00"]
    : Object.keys(WINDOW_LABEL);
  const { rows } = await q.query<Slot>(
    `SELECT ${SLOT_COLS} FROM appointment_slots s
     WHERE ${AVAILABLE} AND s.zone = $3 AND s.service_type = $4 AND s.slot_date >= $5::date AND s."window" = ANY($6::text[])
     ORDER BY s.start_utc, s.slot_id LIMIT 200`,
    [earliest, CLOSED_DATES, args.zone, args.service_type, from, windows],
  );
  // One option per distinct date and window; the caller does not choose a technician.
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const r of rows) {
    const k = `${r.date} ${r.window}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= config.maxSlotsShown) break;
  }
  return out;
}

export async function isSlotAvailable(q: Queryable, slotId: number, zone: Zone, service: ServiceType): Promise<Slot | null> {
  const earliest = new Date(now().getTime() + LEAD_MINUTES * 60_000).toISOString();
  const { rows } = await q.query<Slot>(
    `SELECT ${SLOT_COLS} FROM appointment_slots s WHERE s.slot_id = $3 AND s.zone = $4 AND s.service_type = $5 AND ${AVAILABLE}`,
    [earliest, CLOSED_DATES, slotId, zone, service],
  );
  return rows[0] ?? null;
}

export interface PendingBooking {
  session_id: string;
  slot_id: number;
  zone: Zone;
  zip: string;
  city: string;
  service_type: ServiceType;
  name: string;
  issue: string;
}

export type BookingResult =
  | { ok: true; ref: string; when_label: string; tz: string; date: string; window: string; service: string; tech_first_name: string; replayed: boolean }
  | { ok: false; reason: "slot_taken" | "cap_reached" | "error" };

// The only code path that writes a booking. Runs in one transaction; the DB trigger is a second line of defence.
export async function confirmBooking(
  tx: Queryable,
  p: PendingBooking,
  idempotencyKey: string,
): Promise<BookingResult> {
  const prior = await tx.query<{ booking_ref: string; date: string; window: string; service_type: ServiceType; tech_name: string }>(
    `SELECT a.booking_ref, to_char(s.slot_date,'YYYY-MM-DD') AS date, s."window" AS window, s.service_type, t.name AS tech_name
     FROM appointments a JOIN appointment_slots s ON s.slot_id = a.slot_id JOIN technicians t ON t.tech_id = s.tech_id
     WHERE a.idempotency_key = $1 AND a.booked_by_session = $2`,
    [idempotencyKey, p.session_id],
  );
  if (prior.rows[0]) {
    const r = prior.rows[0];
    return { ok: true, replayed: true, ref: r.booking_ref, date: r.date, window: r.window, when_label: whenLabel(r.date, r.window),
      tz: config.tz, service: SERVICE_LABEL[r.service_type], tech_first_name: r.tech_name.split(" ")[0] };
  }
  const sess = await tx.query<{ bookings_made: number }>(
    `SELECT bookings_made FROM sessions WHERE session_id = $1 FOR UPDATE`, [p.session_id]);
  if (!sess.rows[0]) return { ok: false, reason: "error" };
  if (sess.rows[0].bookings_made >= config.bookingsPerSession) return { ok: false, reason: "cap_reached" };

  const slotRow = await tx.query<{ tech_id: number }>(
    `SELECT tech_id FROM appointment_slots WHERE slot_id = $1 FOR UPDATE`, [p.slot_id]);
  if (!slotRow.rows[0]) return { ok: false, reason: "slot_taken" };
  // Serialize all bookings for this technician, then re-check availability by time range.
  await tx.query(`SELECT 1 FROM technicians WHERE tech_id = $1 FOR UPDATE`, [slotRow.rows[0].tech_id]);
  const slot = await isSlotAvailable(tx, p.slot_id, p.zone, p.service_type);
  if (!slot) return { ok: false, reason: "slot_taken" };

  const customerId = `DEMO-${randomBytes(4).toString("hex").toUpperCase()}`;
  const ref = `MHC-B${randomBytes(3).toString("hex").toUpperCase()}`;
  await tx.query(
    `INSERT INTO customers (customer_id, name, phone, service_address, city, zip, created_by_session)
     VALUES ($1, $2, 'not collected (demo)', 'not collected (demo)', $3, $4, $5)`,
    [customerId, p.name, p.city || "Austin", p.zip, p.session_id],
  );
  await tx.query(
    `INSERT INTO appointments (slot_id, customer_id, issue_description, booked_by_session, idempotency_key, booking_ref)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [p.slot_id, customerId, p.issue.slice(0, 200), p.session_id, idempotencyKey, ref],
  );
  await tx.query(`UPDATE appointment_slots SET status = 'booked' WHERE slot_id = $1`, [p.slot_id]);
  await tx.query(`UPDATE sessions SET bookings_made = bookings_made + 1 WHERE session_id = $1`, [p.session_id]);
  const tech = await tx.query<{ name: string }>(`SELECT name FROM technicians WHERE tech_id = $1`, [slot.tech_id]);
  return { ok: true, replayed: false, ref, date: slot.date, window: slot.window, when_label: whenLabel(slot.date, slot.window),
    tz: config.tz, service: SERVICE_LABEL[p.service_type], tech_first_name: (tech.rows[0]?.name ?? "").split(" ")[0] };
}

export function isConstraintViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "23P01" || code === "23505";
}
