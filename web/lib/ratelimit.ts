import type { Queryable } from "./db";

// In-memory request windows (single instance) per session and per client IP, plus a daily model spend cap in Postgres.
const g = globalThis as { __rl?: Map<string, { start: number; count: number }> };
const windows = (g.__rl ??= new Map());

let lastPrune = 0;
// count=false only checks the window, for limits that count failures after the fact.
export function allow(key: string, limit: number, windowMs: number, count = true): { ok: true } | { ok: false; retryAfterS: number } {
  const now = Date.now();
  // Drop windows older than the longest one in use (a day), at most once a minute, so the map can't grow without bound.
  if (now - lastPrune > 60_000) {
    lastPrune = now;
    for (const [k, v] of windows) if (now - v.start > 86_400_000) windows.delete(k);
  }
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    if (count) windows.set(key, { start: now, count: 1 });
    return { ok: true };
  }
  if (w.count >= limit) return { ok: false, retryAfterS: Math.ceil((w.start + windowMs - now) / 1000) };
  if (count) w.count++;
  return { ok: true };
}

// Daily cost guard at list prices (lib/pricing.ts), counting cache reads and writes at their own rates. The running total
// lives in Postgres (app_meta, one row per UTC day), so a deploy or restart doesn't reset it.
const day = () => new Date().toISOString().slice(0, 10);
const cap = () => Number(process.env.DAILY_SPEND_CAP_USD ?? 5);
export async function addSpend(q: Queryable, usd: number) {
  if (!(usd > 0)) return;
  await q.query(`INSERT INTO app_meta (key, value) VALUES ($1, $2::text)
    ON CONFLICT (key) DO UPDATE SET value = (app_meta.value::numeric + $2::numeric)::text`, [`spend:${day()}`, usd.toFixed(6)]);
}
export async function spendToday(q: Queryable): Promise<{ usd: number; cap: number }> {
  const { rows } = await q.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = $1`, [`spend:${day()}`]);
  return { usd: Number(rows[0]?.value ?? 0), cap: cap() };
}
export async function overSpendCap(q: Queryable): Promise<boolean> {
  const s = await spendToday(q);
  return s.usd >= s.cap;
}

// One rate-limit bucket per IPv4 address, or per IPv6 /64 (one home or host usually gets a whole /64).
export function ipBucket(raw: string): string {
  const ip = raw.split("%")[0].toLowerCase(); // drop an IPv6 zone id
  const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip); // IPv4-mapped IPv6 is the IPv4 address
  if (mapped) return mapped[1];
  const hexMapped = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip); // the same, written in hex (::ffff:7f00:1)
  if (hexMapped) {
    const [hi, lo] = [parseInt(hexMapped[1], 16), parseInt(hexMapped[2], 16)];
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (!ip.includes(":") || ip === "::1") return ip;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - (tail ? tail.split(":").length : 0))).fill("0"), ...(tail ? tail.split(":") : [])];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// The client address as the edge proxy saw it, returned as its rate-limit bucket (IPv4, or IPv6 /64), which is all it is
// used for. Which header carries it depends on the host, so CLIENT_IP_SOURCE picks it: "x_real_ip" (Railway's edge sets it
// on every request), "fly_client_ip" (Fly.io's proxy sets Fly-Client-IP), "xff_last" (the entry a proxy appends) or
// "xff_first". Check the choice on the live host with
// GET /api/staff/ip-check, sending spoofed headers: the right source ignores them.
export type IpSource = "x_real_ip" | "fly_client_ip" | "xff_last" | "xff_first";
export function ipCandidates(req: Request): Record<IpSource, string | undefined> {
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return { x_real_ip: req.headers.get("x-real-ip")?.trim() || undefined,
    fly_client_ip: req.headers.get("fly-client-ip")?.trim() || undefined, xff_last: parts.at(-1), xff_first: parts[0] };
}
export function clientIp(req: Request): string {
  const source = (process.env.CLIENT_IP_SOURCE ?? "xff_last") as IpSource;
  const c = ipCandidates(req);
  return ipBucket(c[source] ?? c.xff_last ?? "unknown");
}
