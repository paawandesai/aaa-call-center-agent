import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../lib/db";
import { migrate } from "../lib/migrate";
import { changeAppointment, demoIdentities, lateFee, verifyCaller } from "../lib/accounts";
import { findSlots } from "../lib/scheduling";
import { loadSeedFromSqlite, resetLiveTables, seedOffsetDays } from "../lib/seed";
import { maybeNightlyReset } from "../lib/reset";
import { pgliteDb } from "./pglite";

// The DST and double-booking checks on a tiny synthetic database built here, so they run in CI without the partner's data.

function buildFixture(file: string) {
  const s = new DatabaseSync(file);
  s.exec(`CREATE TABLE technicians (tech_id INTEGER, name TEXT, skills TEXT, home_zone TEXT);
    CREATE TABLE customers (customer_id TEXT, name TEXT, phone TEXT, email TEXT, service_address TEXT, city TEXT, zip TEXT,
      membership_tier TEXT, membership_renewal_date TEXT, system_brand TEXT, system_install_date TEXT);
    CREATE TABLE appointment_slots (slot_id INTEGER, slot_date TEXT, window TEXT, tech_id INTEGER, zone TEXT, service_type TEXT, status TEXT);
    CREATE TABLE appointments (appointment_id INTEGER, slot_id INTEGER, customer_id TEXT, issue_description TEXT, created_at TEXT, status TEXT, is_warranty_visit INTEGER);
    CREATE TABLE invoices (invoice_id TEXT, customer_id TEXT, appointment_id INTEGER, issued_date TEXT, due_date TEXT, amount_cents INTEGER, balance_cents INTEGER, line_items TEXT);
    INSERT INTO technicians VALUES (1, 'Test Tech', 'hvac', 'central');
    INSERT INTO customers VALUES ('FIX-1', 'Test Customer', '512-555-0100', 'test@example.com', '1 Test St', 'Austin', '78745', 'none', '', 'Trane', '');
    -- Before and after the Nov 1 DST change, same wall-clock window.
    INSERT INTO appointment_slots VALUES (1, '2026-10-30', '08:00-12:00', 1, 'central', 'hvac_repair', 'open');
    INSERT INTO appointment_slots VALUES (2, '2026-11-02', '08:00-12:00', 1, 'central', 'hvac_repair', 'open');
    -- Overlapping siblings for one technician: 3 is booked, so 4 (13:00-17:00) must never be offered.
    INSERT INTO appointment_slots VALUES (3, '2026-10-29', '12:00-16:00', 1, 'central', 'hvac_repair', 'booked');
    INSERT INTO appointment_slots VALUES (4, '2026-10-29', '13:00-17:00', 1, 'central', 'hvac_repair', 'open');
    INSERT INTO appointments VALUES (1, 3, 'FIX-1', 'synthetic', '2026-10-01', 'scheduled', 0);
    -- Taken by the synthetic RAIL-1 demo customer that each reset books.
    INSERT INTO appointment_slots VALUES (5, '2026-10-20', '08:00-12:00', 1, 'central', 'hvac_repair', 'open');`);
  s.close();
}

describe("scheduling on a synthetic fixture", () => {
  let d: Db;
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "meridian-fixture-"));
    const file = path.join(dir, "fixture.sqlite");
    buildFixture(file);
    d = await pgliteDb();
    await migrate(d);
    await loadSeedFromSqlite(d, file);
  });
  afterAll(async () => { await d?.close(); rmSync(dir, { recursive: true, force: true }); });

  it("stores Central wall-clock times as UTC across the Nov 1 DST change", async () => {
    const { rows } = await d.query<{ slot_id: number; t: string }>(`SELECT slot_id, to_char(start_utc AT TIME ZONE 'UTC','HH24:MI') AS t FROM appointment_slots WHERE slot_id IN (1,2) ORDER BY slot_id`);
    expect(rows.map((r) => r.t)).toEqual(["13:00", "14:00"]);
  });

  it("never offers a slot that overlaps the technician's booked visit", async () => {
    const ids = (await findSlots(d, { zone: "central", service_type: "hvac_repair" })).map((s) => s.slot_id);
    expect(ids).not.toContain(4);
    expect(ids).toContain(1);
  });

  it("ignores an impossible on_or_after date instead of failing the turn", async () => {
    for (const bad of ["2026-11-31", "2026-13-01", "2026-11-00", "2026-11-32"])
      await expect(findSlots(d, { zone: "central", service_type: "hvac_repair", on_or_after: bad })).resolves.toBeInstanceOf(Array);
  });

  it("rejects an overlapping booking at the database level", async () => {
    await expect(d.query(`INSERT INTO appointments (slot_id, customer_id) VALUES (4, 'FIX-1')`)).rejects.toMatchObject({ code: "23P01" });
  });

  it("rolls the schedule forward by whole weeks once it would run out, rebuilding times for DST", async () => {
    expect(seedOffsetDays(new Date("2026-10-25T12:00:00Z"))).toBe(0);
    expect(seedOffsetDays(new Date("2026-10-26T12:00:00Z"))).toBe(7);
    process.env.DEMO_NOW = "2026-11-25T15:00:00Z";
    try {
      await resetLiveTables(d);
      const { rows } = await d.query<{ day: string; dow: number; t: string }>(`SELECT to_char(slot_date,'YYYY-MM-DD') AS day,
        extract(isodow FROM slot_date)::int AS dow, to_char(start_utc AT TIME ZONE 'UTC','HH24:MI') AS t FROM appointment_slots WHERE slot_id = 1`);
      expect(rows[0]).toEqual({ day: "2026-12-04", dow: 5, t: "14:00" }); // a Friday still, now on standard time
      // Slot 1 now holds RAIL-1's demo visit; the Monday slot is still offered.
      expect((await findSlots(d, { zone: "central", service_type: "hvac_repair" })).map((s) => s.slot_id)).toContain(2);
    } finally {
      process.env.DEMO_NOW = "2026-10-16T14:00:00Z";
      await resetLiveTables(d);
    }
  });

  it("lists only the synthetic 555 demo customers in the rail, each verifiable with a visit and an open invoice", async () => {
    const ids = await demoIdentities(d);
    expect(ids.map((i) => i.phone)).toEqual(["512-555-0161"]); // only RAIL-1's zone has a slot in this fixture
    expect(ids.map((i) => i.phone)).not.toContain("512-555-0100");
    expect(await verifyCaller(d, "512-555-0161", "78745")).toMatchObject({ customerId: "RAIL-1" });
    const { rows } = await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM invoices WHERE customer_id LIKE 'RAIL-%' AND balance_cents > 0`);
    expect(rows[0].n).toBe(3);
  });

  it("lets a caller at the booking cap still cancel", async () => {
    await d.query(`INSERT INTO sessions (session_id, role, expires_at, bookings_made) VALUES ('capped','caller', now() + interval '1 day', 99)`);
    const { rows } = await d.query<{ id: number }>(`SELECT appointment_id::int AS id FROM appointments WHERE customer_id = 'RAIL-1'`);
    const base = { session_id: "capped", customer_id: "RAIL-1", appointment_id: rows[0].id, service_type: "hvac_repair" as const, zone: "central" as const };
    expect(await d.tx((q) => changeAppointment(q, { ...base, action: "reschedule", new_slot_id: 2 }, "k1"))).toEqual({ ok: false, reason: "cap_reached" });
    // A card shown before a reset names the visit by its old date; the same id now points at a different visit.
    expect(await d.tx((q) => changeAppointment(q, { ...base, action: "cancel", date: "2020-01-01" }, "k0"))).toEqual({ ok: false, reason: "not_found" });
    expect(await d.tx((q) => changeAppointment(q, { ...base, action: "cancel" }, "k2"))).toMatchObject({ ok: true, action: "cancel" });
  });
});

describe("past slots, closed days and the late fee (final audit, 2026-10-18)", () => {
  let d: Db;
  let dir: string;
  const add = (id: number, date: string, window: string) => d.query(`INSERT INTO appointment_slots
      (slot_id, slot_date, "window", tech_id, zone, service_type, status, start_utc, end_utc)
    VALUES ($1, $2::date, $3, 1, 'central', 'hvac_repair', 'open',
      ($2::date + split_part($3, '-', 1)::time) AT TIME ZONE 'America/Chicago',
      ($2::date + split_part($3, '-', 2)::time) AT TIME ZONE 'America/Chicago')`, [id, date, window]);
  const offered = async (on: string) =>
    (await findSlots(d, { zone: "central", service_type: "hvac_repair", on_or_after: on })).filter((s) => s.date === on).map((s) => s.slot_id);
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "meridian-fixture-"));
    const file = path.join(dir, "fixture.sqlite");
    buildFixture(file);
    d = await pgliteDb();
    await migrate(d);
    await loadSeedFromSqlite(d, file);
    await add(101, "2026-10-16", "08:00-12:00"); // already started at the pinned clock (9 am Central)
    await add(102, "2026-10-16", "16:00-19:00"); // later the same day
    await add(103, "2026-11-26", "08:00-12:00"); // Thanksgiving
    await add(104, "2026-12-24", "08:00-12:00"); // Christmas Eve morning
    await add(105, "2026-12-24", "12:00-16:00"); // Christmas Eve afternoon: closed
  });
  afterAll(async () => { await d?.close(); rmSync(dir, { recursive: true, force: true }); });

  it("never offers a slot that has started or starts within the lead time", async () => {
    expect(await offered("2026-10-16")).toEqual([102]);
  });

  it("never offers a holiday closure, and only the morning on Christmas Eve", async () => {
    expect(await offered("2026-11-26")).toEqual([]);
    expect(await offered("2026-12-24")).toEqual([104]);
  });

  it("purges events, feedback, reviews, staff flags and spend totals after 30 days, and handoffs after 7", async () => {
    const old = "now() - interval '31 days'", week = "now() - interval '8 days'";
    await d.query(`INSERT INTO events (ts, session_id, kind) VALUES (${old}, 'p-old', 'turn'), (now(), 'p-new', 'turn')`);
    await d.query(`INSERT INTO feedback (created_at, session_id, rating) VALUES (${old}, 'p-old', 'down'), (now(), 'p-new', 'down')`);
    await d.query(`INSERT INTO reviews (created_at, turn_id, flag, decision) VALUES (${old}, 'p-old', 'other', 'agree'), (now(), 'p-new', 'other', 'agree')`);
    await d.query(`INSERT INTO staff_flags (created_at, handoff_id, flag) VALUES (${old}, 9001, 'summary_wrong'), (now(), 9002, 'summary_wrong')`);
    await d.query(`INSERT INTO handoffs (session_id, reason, summary, created_at) VALUES ('p-old','complaint','x', ${week}), ('p-new','complaint','y', now())`);
    await d.query(`INSERT INTO app_meta (key, value) VALUES ('spend:' || to_char(${old}, 'YYYY-MM-DD'), '1'), ('spend:' || to_char(now(), 'YYYY-MM-DD'), '1')
      ON CONFLICT (key) DO NOTHING`);
    await d.query(`INSERT INTO app_meta (key, value) VALUES ('last_reset', (now() - interval '2 days')::text)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
    process.env.DEMO_ACTIVITY = "0";
    try {
      expect(await maybeNightlyReset(d)).toBe(true);
    } finally {
      delete process.env.DEMO_ACTIVITY;
    }
    const left = async (sql: string) => (await d.query<{ n: number }>(sql)).rows[0].n;
    expect(await left(`SELECT count(*)::int AS n FROM events WHERE session_id = 'p-old'`)).toBe(0);
    expect(await left(`SELECT count(*)::int AS n FROM events WHERE session_id = 'p-new'`)).toBe(1);
    expect(await left(`SELECT count(*)::int AS n FROM feedback WHERE session_id LIKE 'p-%'`)).toBe(1);
    expect(await left(`SELECT count(*)::int AS n FROM reviews WHERE turn_id LIKE 'p-%'`)).toBe(1);
    expect(await left(`SELECT count(*)::int AS n FROM staff_flags WHERE handoff_id IN (9001, 9002)`)).toBe(1);
    expect(await left(`SELECT count(*)::int AS n FROM handoffs WHERE session_id LIKE 'p-%'`)).toBe(1);
    expect(await left(`SELECT count(*)::int AS n FROM app_meta WHERE key = 'spend:' || to_char(now() - interval '31 days', 'YYYY-MM-DD')`)).toBe(0);
  });

  it("charges the late fee only inside 24 hours of the window", () => {
    expect(lateFee("2026-10-17T13:00:00Z")).toMatch(/\$49/); // 23 hours away
    expect(lateFee("2026-10-17T15:00:00Z")).toBeNull(); // 25 hours away
  });
});
