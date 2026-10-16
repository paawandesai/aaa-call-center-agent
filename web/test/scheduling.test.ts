import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../lib/db";
import { migrate } from "../lib/migrate";
import { loadSeedFromSqlite } from "../lib/seed";
import { confirmBooking, findSlots, isSlotAvailable, type PendingBooking } from "../lib/scheduling";
import { pgliteDb } from "./pglite";

// Runs against the partner's mock DB when it is present locally. It is never committed, so CI skips this file.
const SQLITE = path.join(process.env.MERIDIAN_DATA_DIR ?? "/mnt/project-files/data/meridian_dataset", "scheduling_db/meridian_scheduling.sqlite");
const run = existsSync(SQLITE) ? describe : describe.skip;
process.env.DEMO_NOW = "2026-10-16T14:00:00Z";

run("scheduling against the seeded mock DB", () => {
  let d: Db;
  beforeAll(async () => {
    d = await pgliteDb();
    await migrate(d);
    await loadSeedFromSqlite(d, SQLITE);
    await d.query(`INSERT INTO sessions (session_id, role, expires_at) VALUES ('s1','caller', now() + interval '1 day'), ('s2','caller', now() + interval '1 day')`);
  });
  afterAll(async () => d?.close());

  it("stores Central wall-clock times as UTC across the Nov 1 DST change", async () => {
    const { rows } = await d.query<{ before: string; after: string }>(`SELECT
      (SELECT to_char(start_utc AT TIME ZONE 'UTC','HH24:MI') FROM appointment_slots WHERE slot_date='2026-10-30' AND "window"='08:00-12:00' LIMIT 1) AS before,
      (SELECT to_char(start_utc AT TIME ZONE 'UTC','HH24:MI') FROM appointment_slots WHERE slot_date='2026-11-02' AND "window"='08:00-12:00' LIMIT 1) AS after`);
    expect(rows[0]).toEqual({ before: "13:00", after: "14:00" });
  });

  it("never offers a slot whose technician is already booked in an overlapping range", async () => {
    const { rows } = await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM appointment_slots s
      WHERE s.status = 'open' AND EXISTS (SELECT 1 FROM appointments a JOIN appointment_slots o ON o.slot_id = a.slot_id
        WHERE a.status='scheduled' AND o.tech_id = s.tech_id AND tstzrange(o.start_utc,o.end_utc) && tstzrange(s.start_utc,s.end_utc))`);
    expect(rows[0].n).toBeGreaterThan(0); // the trap exists in the data
    for (const zone of ["north", "central", "south"] as const) {
      for (const service_type of ["hvac_repair", "hvac_tune_up", "plumbing", "estimate"] as const) {
        const slots = await findSlots(d, { zone, service_type });
        for (const s of slots) {
          const clash = await d.query(`SELECT 1 FROM appointments a JOIN appointment_slots o ON o.slot_id=a.slot_id
            WHERE a.status='scheduled' AND o.tech_id=$1 AND tstzrange(o.start_utc,o.end_utc) && tstzrange($2::timestamptz,$3::timestamptz)`,
            [s.tech_id, s.start_utc, s.end_utc]);
          expect(clash.rows).toHaveLength(0);
          expect(new Date(s.start_utc).getTime()).toBeGreaterThan(Date.parse("2026-10-16T14:00:00Z"));
        }
      }
    }
  });

  it("reports the known coverage gaps instead of inventing slots", async () => {
    expect(await findSlots(d, { zone: "north", service_type: "plumbing" })).toHaveLength(0);
    expect(await findSlots(d, { zone: "central", service_type: "estimate" })).toHaveLength(0);
  });

  it("books once, blocks the overlapping sibling, and replays idempotently", async () => {
    const [slot] = await findSlots(d, { zone: "central", service_type: "hvac_repair" });
    const p: PendingBooking = { session_id: "s1", slot_id: slot.slot_id, zone: "central", zip: "78745", city: "Austin",
      service_type: "hvac_repair", name: "Test Caller", issue: "AC blowing warm" };
    const r1 = await d.tx((q) => confirmBooking(q, p, "k1"));
    expect(r1.ok && !r1.replayed).toBe(true);
    const r2 = await d.tx((q) => confirmBooking(q, p, "k1"));
    expect(r2.ok && r2.replayed && r1.ok && r2.ref === r1.ref).toBe(true);
    const r3 = await d.tx((q) => confirmBooking(q, { ...p, session_id: "s2" }, "k2"));
    expect(r3).toEqual({ ok: false, reason: "slot_taken" });
    const siblings = await d.query<{ slot_id: number }>(`SELECT o.slot_id FROM appointment_slots o, appointment_slots s
      WHERE s.slot_id=$1 AND o.tech_id=s.tech_id AND o.slot_id<>s.slot_id AND o.status='open'
        AND tstzrange(o.start_utc,o.end_utc) && tstzrange(s.start_utc,s.end_utc)`, [slot.slot_id]);
    for (const sib of siblings.rows) {
      const { rows } = await d.query<{ zone: string; service_type: string }>(`SELECT zone, service_type FROM appointment_slots WHERE slot_id=$1`, [sib.slot_id]);
      expect(await isSlotAvailable(d, sib.slot_id, rows[0].zone as never, rows[0].service_type as never)).toBeNull();
    }
  });

  it("rejects an overlapping insert at the database level even if app checks are bypassed", async () => {
    const { rows } = await d.query<{ slot_id: number }>(`SELECT o.slot_id FROM appointments a JOIN appointment_slots s ON s.slot_id=a.slot_id
      JOIN appointment_slots o ON o.tech_id=s.tech_id AND o.slot_id<>s.slot_id AND o.status='open'
        AND tstzrange(o.start_utc,o.end_utc) && tstzrange(s.start_utc,s.end_utc)
      WHERE a.status='scheduled' LIMIT 1`);
    await expect(d.query(`INSERT INTO appointments (slot_id, customer_id) VALUES ($1, 'MHC-10001')`, [rows[0].slot_id]))
      .rejects.toMatchObject({ code: "23P01" });
  });

  it("caps bookings per session", async () => {
    const slots = await findSlots(d, { zone: "south", service_type: "plumbing" });
    const base = { session_id: "s1", zone: "south" as const, zip: "78640", city: "Kyle", service_type: "plumbing" as const, name: "T", issue: "leak" };
    const a = await d.tx((q) => confirmBooking(q, { ...base, slot_id: slots[0].slot_id }, "k3"));
    expect(a.ok).toBe(true);
    const b = await d.tx((q) => confirmBooking(q, { ...base, slot_id: slots[1].slot_id }, "k4"));
    expect(b).toEqual({ ok: false, reason: "cap_reached" });
  });
});
