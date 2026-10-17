import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getConversation } from "../lib/conversations";
import type { Db } from "../lib/db";
import { createHandoff } from "../lib/handoffs";
import { migrate } from "../lib/migrate";
import { ipBucket } from "../lib/ratelimit";
import { pgliteDb } from "./pglite";

describe("rate-limit buckets", () => {
  it("keys IPv4 by address and IPv6 by /64", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("2001:db8:aa:1::5")).toBe("2001:db8:aa:1::/64");
    expect(ipBucket("2001:0db8:00aa:0001:ffff::9")).toBe("2001:db8:aa:1::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});

describe("handoff tickets", () => {
  let d: Db;
  beforeAll(async () => { d = await pgliteDb(); await migrate(d); });
  afterAll(async () => { await d?.close(); });
  const count = async () => (await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM handoffs`)).rows[0].n;

  it("keeps one open ticket per session and reason, even across new chats", async () => {
    for (let i = 0; i < 3; i++) {
      const c = getConversation("s-flood", `conv-${i}-xxxxxxxx`);
      await createHandoff(d, c, "safety", "x", "I smell gas", "policy");
    }
    expect(await count()).toBe(1);
  });

  it("caps tickets per IP at five a day, and labels rule-based summaries as not AI-written", async () => {
    for (let i = 0; i < 8; i++) {
      const c = getConversation(`s-ip-${i}`, `conv-ip-${i}-xxxxxxxx`);
      c.clientIp = "198.51.100.9";
      await createHandoff(d, c, "safety", "Sent by a fixed rule", "I smell gas", "policy");
    }
    expect(await count()).toBe(1 + 5);
    const { rows } = await d.query<{ summary: string }>(`SELECT summary FROM handoffs LIMIT 1`);
    expect(rows[0].summary.startsWith("AI-written")).toBe(false);
  });
});
