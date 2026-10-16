import { db } from "./db";

// First-party metadata only: ids, enums, counts and timings. Never caller text, names or model output.
export interface EventRow {
  session_id?: string; turn_id?: string; kind: string; intent?: string; outcome?: string; reason?: string;
  latency_ms?: number; first_token_ms?: number; input_tokens?: number; output_tokens?: number; top_score?: number;
  meta?: Record<string, string | number | boolean | null>;
}

export async function record(e: EventRow) {
  try {
    await db().query(
      `INSERT INTO events (session_id, turn_id, kind, intent, outcome, reason, latency_ms, first_token_ms, input_tokens, output_tokens, top_score, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [e.session_id ?? null, e.turn_id ?? null, e.kind, e.intent ?? null, e.outcome ?? null, e.reason ?? null, e.latency_ms ?? null,
       e.first_token_ms ?? null, e.input_tokens ?? null, e.output_tokens ?? null, e.top_score ?? null, JSON.stringify(e.meta ?? {})],
    );
  } catch {
    // Telemetry must never break a caller's turn.
  }
}
