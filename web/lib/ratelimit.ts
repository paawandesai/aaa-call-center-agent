// In-memory limits (single instance). Per-session request windows plus a daily model spend cap.
const g = globalThis as { __rl?: Map<string, { start: number; count: number }>; __spend?: { day: string; usd: number } };
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

// Daily cost guard at list prices (lib/pricing.ts), counting cache reads and writes at their own rates.
const spend = (g.__spend ??= { day: "", usd: 0 });
const day = () => new Date().toISOString().slice(0, 10);
export function addSpend(usd: number) {
  if (spend.day !== day()) { spend.day = day(); spend.usd = 0; }
  spend.usd += usd;
}
export function overSpendCap(): boolean {
  if (spend.day !== day()) return false;
  return spend.usd >= Number(process.env.DAILY_SPEND_CAP_USD ?? 5);
}
export function spendToday(): { usd: number; cap: number } {
  return { usd: spend.day === day() ? spend.usd : 0, cap: Number(process.env.DAILY_SPEND_CAP_USD ?? 5) };
}
