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

// Rough cost guard at list prices (input $4 / output $20 per million tokens). Cached reads are counted at full price.
const spend = (g.__spend ??= { day: "", usd: 0 });
const day = () => new Date().toISOString().slice(0, 10);
export function addSpend(inputTokens: number, outputTokens: number) {
  if (spend.day !== day()) { spend.day = day(); spend.usd = 0; }
  spend.usd += (inputTokens * 4 + outputTokens * 20) / 1_000_000;
}
export function overSpendCap(): boolean {
  if (spend.day !== day()) return false;
  return spend.usd >= Number(process.env.DAILY_SPEND_CAP_USD ?? 5);
}
