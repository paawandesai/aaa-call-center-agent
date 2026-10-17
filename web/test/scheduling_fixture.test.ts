import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../lib/db";
import { migrate } from "../lib/migrate";
import { findSlots } from "../lib/scheduling";
import { loadSeedFromSqlite, resetLiveTables, seedOffsetDays } from "../lib/seed";
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
    INSERT INTO appointments VALUES (1, 3, 'FIX-1', 'synthetic', '2026-10-01', 'scheduled', 0);`);
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
      expect((await findSlots(d, { zone: "central", service_type: "hvac_repair" })).map((s) => s.slot_id)).toContain(1);
    } finally {
      process.env.DEMO_NOW = "2026-10-16T14:00:00Z";
      await resetLiveTables(d);
    }
  });
});
