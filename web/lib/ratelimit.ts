import type { Queryable } from "./db";

// In-memory request windows (single instance) per session and per client IP, plus a daily model spend cap in Postgres.
const g = globalThis as { __rl?: Map<string, { start: number; count: number }> };
const windows = (g.__rl ??= new Map());

export function allow(key: string, limit: number, windowMs: number): { ok: true } | { ok: false; retryAfterS: number } {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return { ok: true };
  }
  if (w.count >= limit) return { ok: false, retryAfterS: Math.ceil((w.start + windowMs - now) / 1000) };
  w.count++;
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

// The client address as Railway's edge proxy saw it: the last X-Forwarded-For entry is the one the proxy appended,
// so a client can't choose it by sending its own header.
export function clientIp(req: Request): string {
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.at(-1) ?? "unknown";
}
