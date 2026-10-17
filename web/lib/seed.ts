import { DatabaseSync } from "node:sqlite";
import { now } from "./config";
import type { Db, Queryable } from "./db";

type Row = Record<string, unknown>;

// Copies the partner's SQLite into seed_* tables (pristine) and then restores live tables from them.
export async function loadSeedFromSqlite(d: Db, sqlitePath: string) {
  const lite = new DatabaseSync(sqlitePath, { readOnly: true });
  const all = (sql: string) => lite.prepare(sql).all() as Row[];
  await d.tx(async (q) => {
    await q.query(`TRUNCATE seed_invoices, seed_appointments, seed_appointment_slots, seed_customers`);
    for (const t of all(`SELECT * FROM technicians`)) {
      await q.query(
        `INSERT INTO technicians VALUES ($1,$2,$3,$4) ON CONFLICT (tech_id) DO UPDATE SET name=$2, skills=$3, home_zone=$4`,
        [t.tech_id, t.name, t.skills, t.home_zone]);
    }
    for (const c of all(`SELECT * FROM customers`)) {
      await q.query(`INSERT INTO seed_customers (customer_id,name,phone,email,service_address,city,zip,membership_tier,
        membership_renewal_date,system_brand,system_install_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [c.customer_id, c.name, c.phone, c.email, c.service_address, c.city, c.zip, c.membership_tier ?? "none",
         c.membership_renewal_date || null, c.system_brand, c.system_install_date || null]);
    }
    for (const s of all(`SELECT * FROM appointment_slots`)) {
      const [a, b] = String(s.window).split("-");
      // Local Central wall-clock -> UTC, so DST (Nov 1, 2026) is applied by Postgres tzdata.
      await q.query(`INSERT INTO seed_appointment_slots (slot_id, slot_date, "window", tech_id, zone, service_type, status, tz, start_utc, end_utc)
        VALUES ($1,$2::date,$3,$4,$5,$6,$7,'America/Chicago',
          ($2::date + $8::time) AT TIME ZONE 'America/Chicago', ($2::date + $9::time) AT TIME ZONE 'America/Chicago')`,
        [s.slot_id, s.slot_date, s.window, s.tech_id, s.zone, s.service_type, s.status, a, b]);
    }
    for (const a of all(`SELECT * FROM appointments`)) {
      await q.query(`INSERT INTO seed_appointments (appointment_id, slot_id, customer_id, issue_description, created_at, status, is_warranty_visit)
        VALUES ($1,$2,$3,$4,($5::date)::timestamp AT TIME ZONE 'America/Chicago',$6,$7)`,
        [a.appointment_id, a.slot_id, a.customer_id, a.issue_description, a.created_at, a.status, Boolean(a.is_warranty_visit)]);
    }
    for (const i of all(`SELECT * FROM invoices`)) {
      await q.query(`INSERT INTO seed_invoices VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [i.invoice_id, i.customer_id, i.appointment_id, i.issued_date, i.due_date, i.amount_cents, i.balance_cents, i.line_items]);
    }
  });
  lite.close();
  await resetLiveTables(d);
}

// Nightly reset: live scheduling tables go back to the partner's seed; demo customers and bookings disappear.
export async function resetLiveTables(d: Db) {
  await d.tx((q) => resetLiveTablesIn(q));
}

// The partner's schedule covers 2026-10-16 to 11-05. So booking keeps working after that, each reset moves the whole seed
// forward by whole weeks (weekdays stay put) once Central "today" is a week or more past 2026-10-19. Slot times are rebuilt
// from Central wall-clock, so DST is still applied by tzdata. Before then, and whenever DEMO_NOW pins the clock, it is 0.
const SEED_ANCHOR = Date.UTC(2026, 9, 19);
export function seedOffsetDays(at: Date = now()): number {
  const [y, m, d] = at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).split("-").map(Number);
  const days = Math.floor((Date.UTC(y, m - 1, d) - SEED_ANCHOR) / 86_400_000);
  return days > 0 ? 7 * Math.floor(days / 7) : 0;
}

export async function resetLiveTablesIn(q: Queryable) {
  const off = seedOffsetDays();
  await q.query(`TRUNCATE invoices, appointments, appointment_slots, customers RESTART IDENTITY CASCADE`);
  await q.query(`INSERT INTO customers (customer_id,name,phone,email,service_address,city,zip,membership_tier,membership_renewal_date,system_brand,system_install_date)
    SELECT customer_id,name,phone,email,service_address,city,zip,membership_tier,membership_renewal_date + $1::int,system_brand,system_install_date
    FROM seed_customers`, [off]);
  await q.query(`INSERT INTO appointment_slots (slot_id, slot_date, "window", tech_id, zone, service_type, status, tz, start_utc, end_utc)
    SELECT slot_id, slot_date + $1::int, "window", tech_id, zone, service_type, status, tz,
      (slot_date + $1::int + split_part("window", '-', 1)::time) AT TIME ZONE 'America/Chicago',
      (slot_date + $1::int + split_part("window", '-', 2)::time) AT TIME ZONE 'America/Chicago'
    FROM seed_appointment_slots`, [off]);
  // The seed already contains overlapping appointments (audit F1). The overlap trigger guards new bookings only.
  await q.query(`ALTER TABLE appointments DISABLE TRIGGER appointments_no_overlap`);
  await q.query(`INSERT INTO appointments (appointment_id, slot_id, customer_id, issue_description, created_at, status, is_warranty_visit)
    SELECT appointment_id, slot_id, customer_id, issue_description, created_at + make_interval(days => $1::int), status, is_warranty_visit
    FROM seed_appointments`, [off]);
  await q.query(`ALTER TABLE appointments ENABLE TRIGGER appointments_no_overlap`);
  await q.query(`SELECT setval(pg_get_serial_sequence('appointments','appointment_id'), (SELECT coalesce(max(appointment_id),1) FROM appointments))`);
  await q.query(`INSERT INTO invoices (invoice_id, customer_id, appointment_id, issued_date, due_date, amount_cents, balance_cents, line_items)
    SELECT invoice_id, customer_id, appointment_id, issued_date + $1::int, due_date + $1::int, amount_cents, balance_cents, line_items
    FROM seed_invoices`, [off]);
  await q.query(`DELETE FROM sessions WHERE expires_at < now()`);
  await q.query(`DELETE FROM events WHERE ts < now() - interval '30 days'`);
  await q.query(`INSERT INTO app_meta VALUES ('last_reset', now()::text) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  await q.query(`INSERT INTO app_meta VALUES ('seed_offset_days', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [String(off)]);
}
