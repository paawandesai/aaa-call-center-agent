import type Anthropic from "@anthropic-ai/sdk";
import type { PendingChange, Verified } from "./accounts";
import type { HandoffReason } from "./policy";
import type { PendingBooking, ServiceType } from "./scheduling";
import type { Zone } from "./zones";

export interface OfferedSlot { slot_id: number; zone: Zone; zip: string; city: string; service_type: ServiceType; date: string; window: string }

// Conversation state lives in server memory only (single instance, 2h TTL) so caller text is never written
// to the database or logs. History is append-only so the model's thinking blocks stay valid.
export interface Conversation {
  id: string;
  sessionId: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  offered: Map<number, OfferedSlot>;
  pending?: PendingBooking;
  pendingChange?: PendingChange;
  verified?: Verified; // set only by a successful phone + ZIP match; scopes every account read and change
  verifyAttempts: number;
  safetyLock: boolean; // one-way: once set, no booking tools run in this conversation
  handoff?: HandoffReason;
  intents: string[];
  steps: string[];
  caller: { zip?: string; name?: string };
  notes: string[]; // app events (e.g. a confirmed booking) passed to the model with the next caller message
  turns: Map<string, number>; // turn_id -> message count after the turn, for retry dedupe
  updatedAt: number;
}

const TTL = 2 * 60 * 60 * 1000;
// On globalThis so every route bundle in the process shares one store.
const g = globalThis as { __conversations?: Map<string, Conversation> };
const store = (g.__conversations ??= new Map<string, Conversation>());

export function getConversation(sessionId: string, id: string): Conversation {
  const now = Date.now();
  for (const [k, c] of store) if (now - c.updatedAt > TTL) store.delete(k);
  const key = `${sessionId}:${id}`;
  let c = store.get(key);
  if (!c) {
    c = { id, sessionId, messages: [], offered: new Map(), safetyLock: false, intents: [], steps: [], caller: {}, verifyAttempts: 0, notes: [], turns: new Map(), updatedAt: now };
    store.set(key, c);
  }
  c.updatedAt = now;
  return c;
}

export function findConversation(sessionId: string, id: string): Conversation | undefined {
  return store.get(`${sessionId}:${id}`);
}
