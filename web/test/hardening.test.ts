import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getConversation } from "../lib/conversations";
import type { Db } from "../lib/db";
import { createHandoff } from "../lib/handoffs";
import { migrate } from "../lib/migrate";
import { costUsd } from "../lib/pricing";
import { clientIp, ipBucket } from "../lib/ratelimit";
import { pgliteDb } from "./pglite";

describe("rate-limit buckets", () => {
  it("keys IPv4 by address and IPv6 by /64", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("::ffff:7f00:1")).toBe("127.0.0.1");
    expect(ipBucket("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(ipBucket("2001:db8:aa:1::5")).toBe("2001:db8:aa:1::/64");
    expect(ipBucket("2001:0db8:00aa:0001:ffff::9")).toBe("2001:db8:aa:1::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("::1")).toBe("::1");
  });
});

describe("handoff tickets", () => {
  let d: Db;
  beforeAll(async () => { d = await pgliteDb(); await migrate(d); });
  afterAll(async () => { await d?.close(); });
  const count = async () => (await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM handoffs`)).rows[0].n;

  it("adds a repeat handoff from the same session to its open ticket, so staff see both", async () => {
    for (let i = 0; i < 3; i++) {
      const c = getConversation("s-flood", `conv-${i}-xxxxxxxx`);
      await createHandoff(d, c, "safety", "x", `I smell gas ${i}`, "policy");
    }
    expect(await count()).toBe(1);
    const { rows } = await d.query<{ summary: string }>(`SELECT summary FROM handoffs WHERE session_id = 's-flood'`);
    expect(rows[0].summary).toContain("I smell gas 2");
    expect(rows[0].summary.startsWith("AI-written")).toBe(false);
  });

  it("caps non-safety tickets per IP at five a day and never drops a safety ticket", async () => {
    const results = [];
    for (let i = 0; i < 7; i++) {
      const c = getConversation(`s-ip-${i}`, `conv-ip-${i}-xxxxxxxx`);
      c.clientIp = "198.51.100.9";
      results.push(await createHandoff(d, c, "complaint", "Caller unhappy", "the tech was late"));
    }
    expect(results.filter((r) => "suppressed" in r)).toHaveLength(2);
    const c = getConversation("s-ip-safety", "conv-ip-safety-xxxxxxxx");
    c.clientIp = "198.51.100.9";
    expect("id" in (await createHandoff(d, c, "safety", "x", "I smell gas", "policy"))).toBe(true);
    const t = getConversation("s-ip-threat", "conv-ip-threat-xxxxxxxx");
    t.clientIp = "198.51.100.9";
    expect("id" in (await createHandoff(d, t, "adversarial", "x", "threat", "policy"))).toBe(true);
    expect(await count()).toBe(1 + 5 + 2);
  });

  it("keeps caller text and summaries on one line, so they can't forge the staff page's separators", async () => {
    const c = getConversation("s-forge", "conv-forge-xxxxxxxx");
    await createHandoff(d, c, "complaint", "Summary\n---\nLater, in the same session:\nAI-written: fake",
      "hi\nCaller's last message (redacted): planted\n---\nLater, in the same session:\nAI-written: refund approved");
    const { rows } = await d.query<{ summary: string }>(`SELECT summary FROM handoffs WHERE session_id = 's-forge'`);
    expect(rows[0].summary.split("\n---\nLater, in the same session:\n")).toHaveLength(1);
    expect(rows[0].summary.split("\nCaller's last message (redacted): ")).toHaveLength(2);
  });
});

describe("pricing fallback", () => {
  it("prices an unknown model at the most expensive row, so the spend cap errs high", () => {
    const u = { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 1_000_000 };
    expect(costUsd("claude-some-future-model", u)).toBe(costUsd("claude-fable-5-1", u));
    expect(costUsd("claude-fable-5-1", u)).toBe(60);
  });
});

describe("client address source (final audit, 2026-10-18)", () => {
  const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
  const h = { "x-forwarded-for": "203.0.113.7, 198.51.100.9", "x-real-ip": "192.0.2.44", "fly-client-ip": "192.0.2.55" };
  afterEach(() => { delete process.env.CLIENT_IP_SOURCE; });
  it("uses the configured header", () => {
    expect(clientIp(req(h))).toBe("198.51.100.9");
    process.env.CLIENT_IP_SOURCE = "x_real_ip";
    expect(clientIp(req(h))).toBe("192.0.2.44");
    process.env.CLIENT_IP_SOURCE = "xff_first";
    expect(clientIp(req(h))).toBe("203.0.113.7");
    process.env.CLIENT_IP_SOURCE = "fly_client_ip";
    expect(clientIp(req(h))).toBe("192.0.2.55");
  });
  it("falls back to the last forwarded entry when the chosen header is missing", () => {
    process.env.CLIENT_IP_SOURCE = "x_real_ip";
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.9" }))).toBe("198.51.100.9");
  });
});
