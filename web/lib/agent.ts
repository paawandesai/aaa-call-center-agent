import Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyUsage, type Usage } from "./pricing";
import { z } from "zod";
import { config, now } from "./config";
import type { Conversation } from "./conversations";
import type { Db } from "./db";
import type { Emit } from "./events";
import { createHandoff } from "./handoffs";
import { HANDOFF_COPY, route, SCRIPTS, type HandoffReason, type SafetyScript } from "./policy";
import { SYSTEM_PROMPT, turnData } from "./prompt";
import type { Passage } from "./retrieval";
import { FEE_LABEL, findSlots, isSlotAvailable, SERVICE_LABEL, whenLabel, type ServiceType, type Slot } from "./scheduling";
import { zipLookup } from "./zones";
import { lateFee, lookupAccount, upcomingAppointments, verifyCaller } from "./accounts";
import { allow } from "./ratelimit";

type Tool = Anthropic.Beta.BetaTool;
const SERVICE_TYPES = ["hvac_repair", "hvac_tune_up", "plumbing", "estimate"] as const;
// The safety labels pick the card the caller sees and are stored as reason safety (threat as adversarial). "safety" means
// gas, CO, fire, smoke or a burning smell: it shows the card the caller's words match, else the gas/CO/fire card.
const MODEL_HANDOFF_REASONS = ["safety", "electrical", "self_harm", "medical", "threat", "caller_in_danger", "urgent_other", "billing_account", "cancel_reschedule", "complaint", "human_requested",
  "low_confidence", "service_area_unclear", "booking_failed", "out_of_scope"] as const;

// Narrow tools. None of them writes: propose_booking and propose_appointment_change only show a card the caller confirms.
export const TOOLS: Tool[] = [
  {
    name: "search_kb",
    description: "Search Meridian's customer-facing knowledge base again with a different query, when the passages provided with the message don't cover the question.",
    strict: true,
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "check_availability",
    description: "Find up to 4 open appointment times for a new visit, or a new time for an existing appointment. The app shows them to the caller as buttons.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        service_type: { type: "string", enum: [...SERVICE_TYPES] },
        zip: { type: "string", description: "5-digit ZIP code of the service address" },
        on_or_after: { type: "string", description: "Earliest date the caller wants, YYYY-MM-DD, or empty for the soonest" },
        part_of_day: { type: "string", enum: ["morning", "afternoon", "evening", "any"] },
      },
      required: ["service_type", "zip", "on_or_after", "part_of_day"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_booking",
    description: "Show the caller a confirmation card for one of the times returned by check_availability. Nothing is booked until the caller presses Confirm.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        slot_id: { type: "integer" },
        caller_name: { type: "string", description: "Name the caller gave for the booking" },
        issue_summary: { type: "string", description: "A few words on what the visit is for" },
      },
      required: ["slot_id", "caller_name", "issue_summary"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_caller",
    description: "Verify the caller before any account question or appointment change, using the phone number on their account and the ZIP code of the service address. Both must match one customer.",
    strict: true,
    input_schema: { type: "object", properties: { phone: { type: "string" }, zip: { type: "string" } }, required: ["phone", "zip"], additionalProperties: false },
  },
  {
    name: "lookup_account",
    description: "Read the verified caller's own records: upcoming appointments, invoices and balance, or membership and renewal date. Only works after verify_caller succeeds.",
    strict: true,
    input_schema: { type: "object", properties: { topic: { type: "string", enum: ["appointments", "invoices", "membership"] } }, required: ["topic"], additionalProperties: false },
  },
  {
    name: "propose_appointment_change",
    description: "Show the verified caller a confirmation card to cancel one of their upcoming appointments, or move it to a time returned by check_availability. Nothing changes until the caller presses Confirm.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        appointment_id: { type: "integer", description: "From lookup_account" },
        action: { type: "string", enum: ["cancel", "reschedule"] },
        new_slot_id: { type: "integer", description: "For reschedule, a slot_id from check_availability; 0 for cancel" },
      },
      required: ["appointment_id", "action", "new_slot_id"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff",
    description: "Pass the conversation to a person on Meridian's team, with a short summary so the caller doesn't have to repeat themselves.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", enum: [...MODEL_HANDOFF_REASONS], description: "safety: gas, carbon monoxide, sparks, smoke, fire or a burning smell. electrical: water near electrical parts, melted or scorched outlets or wires, arcing, shocks. self_harm: the caller talks about hurting themselves or not wanting to live. medical: someone may need emergency care. threat: the caller threatens violence against anyone. caller_in_danger: someone is threatening or hurting the caller, or they are unsafe at home. urgent_other: another emergency that fits none of these." },
        summary: { type: "string", description: "One or two sentences for staff: what the caller needs and what was already tried" },
      },
      required: ["reason", "summary"],
      additionalProperties: false,
    },
  },
];

const SearchIn = z.object({ query: z.string().min(1).max(300) });
const AvailIn = z.object({ service_type: z.enum(SERVICE_TYPES), zip: z.string().max(10), on_or_after: z.string().max(10),
  part_of_day: z.enum(["morning", "afternoon", "evening", "any"]) });
const ProposeIn = z.object({ slot_id: z.number().int(), caller_name: z.string().min(1).max(60), issue_summary: z.string().max(200) });
const VerifyIn = z.object({ phone: z.string().max(30), zip: z.string().max(10) });
const LookupIn = z.object({ topic: z.enum(["appointments", "invoices", "membership"]) });
const ChangeIn = z.object({ appointment_id: z.number().int(), action: z.enum(["cancel", "reschedule"]), new_slot_id: z.number().int() });
const HandoffIn = z.object({ reason: z.enum(MODEL_HANDOFF_REASONS), summary: z.string().min(1).max(600) });

export interface Deps {
  db: Db;
  anthropic: Anthropic;
  search: (query: string) => Promise<Passage[]>;
}

export interface TurnResult {
  outcome: "answered" | "slots_offered" | "confirm_shown" | "change_shown" | "handoff" | "safety" | "deflected" | "error";
  handoffReason?: HandoffReason;
  intent?: string;
  inputTokens: number; // all input, cached or not
  outputTokens: number;
  usage: Usage;
  topScore?: number;
  firstTokenMs?: number;
  toolCalls: string[];
}

// What the caller sees under "What I've passed on" for policy-routed handoffs.
const INTENT_SUMMARY: Record<string, string> = {
  gas_leak: "You reported a possible gas smell. I showed the safety steps and marked it urgent.",
  carbon_monoxide: "You reported a carbon monoxide alarm. I showed the safety steps and marked it urgent.",
  sparks_smoke: "You reported sparks or smoke. I showed the safety steps and marked it urgent.",
  burning_smell: "You reported a burning smell. I showed the safety steps and marked it urgent.",
  self_harm: "You told me you're going through something serious. I shared the 988 crisis line and marked it urgent.",
  medical: "You told me someone may need emergency care. I asked you to call 911 and marked it urgent.",
  electrical: "You reported an electrical hazard. I showed the safety steps and marked it urgent.",
  threat: "This chat has been passed to our team.",
  domestic_violence: "You told me you may not be safe at home. I shared the hotline and asked a person to follow up carefully.",
  urgent: "You told me about something urgent. I marked it for our team right away.",
  in_danger: "You told me you may be in danger. I asked you to call 911 and marked it urgent for our team.",
  human_requested: "You asked to speak with a person. Your message is in the queue.",
  cancel_reschedule: "You want to change or cancel an existing appointment.",
  billing: "You have a question about a bill, charge or payment.",
  account_lookup: "You have a question that needs your account records.",
  existing_appointment: "You want details about an existing appointment.",
  complaint: "You have a concern about a past visit or our service.",
  membership_cancel: "You want to cancel your Comfort Club membership.",
  tech_late: "Your technician hasn't arrived and you want an update.",
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: config.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
const slotEvent = (s: Slot) => ({ slot_id: s.slot_id, date: s.date, window_label: whenLabel(s.date, s.window), tz: "America/Chicago" as const });

export async function runTurn(deps: Deps, c: Conversation, callerText: string, emit: Emit, signal?: AbortSignal): Promise<TurnResult> {
  const started = Date.now();
  const res: TurnResult = { outcome: "answered", inputTokens: 0, outputTokens: 0, usage: emptyUsage(), toolCalls: [] };
  const text = callerText.slice(0, 2000);

  const scripted = async (reply: string, reason: HandoffReason | null, intent: string) => {
    c.intents.push(intent);
    // Keep the transcript coherent for later turns; the scripted reply is ours, not the model's.
    c.messages.push({ role: "user", content: turnData(today(), [], text) });
    c.messages.push({ role: "assistant", content: reply });
    if (reason) {
      // One handoff per reason per conversation: repeating the request doesn't add another ticket to the queue.
      const h = c.handoff === reason ? undefined : await createHandoff(deps.db, c, reason, `Routed by policy (${intent}).`, text);
      c.handoff = reason;
      emit({ type: "handoff", reason_enum: reason, summary_for_caller: INTENT_SUMMARY[intent] ?? HANDOFF_COPY[reason], queue_position: h?.position });
    }
  };

  // 1. Deterministic policy runs first. Safety is one-way.
  const r = route(text);
  if (r.kind === "safety") {
    lockForSafety(c, r.script);
    const reason: HandoffReason = r.script === "threat" ? "adversarial" : "safety";
    emit({ type: "safety", script: r.script, text: SCRIPTS[r.script] });
    await scripted(SCRIPTS[r.script], reason, r.intent);
    return { ...res, outcome: "safety", handoffReason: reason, intent: r.intent };
  }
  if (r.kind === "handoff") {
    emit({ type: "text_delta", text: HANDOFF_COPY[r.reason] });
    await scripted(HANDOFF_COPY[r.reason], r.reason, r.intent);
    return { ...res, outcome: "handoff", handoffReason: r.reason, intent: r.intent };
  }
  // After the 988 script the model never takes the conversation back: every later message gets the same short, fixed reply.
  if (c.selfHarm) {
    emit({ type: "text_delta", text: SCRIPTS.self_harm_followup });
    await scripted(SCRIPTS.self_harm_followup, null, "self_harm");
    return { ...res, outcome: "safety", handoffReason: "safety", intent: "self_harm" };
  }
  if (r.kind === "deflect") {
    // An injection attempt in the middle of a booking doesn't drop the booking: the caller is asked for a plain name.
    const reply = r.script === "injection" && c.offered.size && !c.safetyLock
      ? `${SCRIPTS.injection} If you'd still like the visit you picked, just tell me the name to book it under.` : SCRIPTS[r.script];
    emit({ type: "text_delta", text: reply });
    await scripted(reply, null, r.intent);
    return { ...res, outcome: "deflected", intent: r.intent };
  }

  // 2. Retrieval for this message. A bare ZIP, a slot pick or a name answers the assistant's own question, so it skips the search.
  const logistics = isLogistics(text);
  if (!logistics) emit({ type: "status", phase: "searching_kb" });
  const passages = logistics ? [] : (await deps.search(text)).filter((p) => p.score >= config.minRetrievalScore);
  res.topScore = passages[0]?.score;
  const used: Passage[] = [...passages];
  const notes = [c.caller.zip ? `The caller's ZIP code is ${c.caller.zip}.` : "", c.verified ? `The caller is verified as ${c.verified.firstName}.` : "",
    ...c.notes.splice(0)].filter(Boolean);
  const extra = notes.length ? notes.join(" ") : undefined;
  const base = c.messages.length;
  c.messages.push({ role: "user", content: turnData(today(), passages, text, extra) });

  let sawUiCard = false;
  try {
    for (let round = 0; round < config.maxToolRounds + 1; round++) {
      const stream = deps.anthropic.beta.messages.stream(
        {
          model: config.model,
          max_tokens: config.maxTokens,
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools: TOOLS, // never varies within a conversation, so the cache prefix and thinking blocks stay valid
          tool_choice: round < config.maxToolRounds ? { type: "auto" } : { type: "none" },
          thinking: { type: "adaptive" },
          output_config: { effort: config.effort },
          cache_control: { type: "ephemeral" }, // automatic breakpoint on the growing conversation; the system marker covers tools + system
          ...(config.serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          messages: c.messages,
        },
        { signal },
      );
      let roundChars = 0, roundText = "", noteChecked = false;
      const hadFirstToken = res.firstTokenMs !== undefined;
      stream.on("text", (delta) => {
        res.firstTokenMs ??= Date.now() - started;
        roundChars += delta.length;
        roundText += delta;
        emit({ type: "text_delta", text: delta });
        // A short opening paragraph that never addresses the caller is a note to self ("Need ZIP first."): take it back.
        const cut = roundText.indexOf("\n\n");
        if (!noteChecked && cut >= 0) {
          noteChecked = true;
          if (isSelfNote(roundText.slice(0, cut))) { emit({ type: "text_discard", chars: roundChars }); roundChars = roundText.length - cut - 2; emit({ type: "text_delta", text: roundText.slice(cut + 2) }); }
        }
      });
      const msg = await stream.finalMessage();
      // Text written alongside a tool call is the model thinking aloud, not a reply; take it back off the screen.
      if (roundChars && msg.content.some((b) => b.type === "tool_use")) {
        emit({ type: "text_discard", chars: roundChars });
        if (!hadFirstToken) res.firstTokenMs = undefined; // time to first word counts shown words only
      }
      res.inputTokens += (msg.usage.input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
      res.outputTokens += msg.usage.output_tokens ?? 0;
      res.usage = addUsage(res.usage, { input: msg.usage.input_tokens ?? 0, cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        cacheWrite: msg.usage.cache_creation_input_tokens ?? 0, output: msg.usage.output_tokens ?? 0 });
      c.messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });

      if (msg.stop_reason === "refusal") {
        await modelHandoff(deps, c, "low_confidence", "The assistant declined to answer.", text, emit, res);
        break;
      }
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) break;
      if (msg.stop_reason === "max_tokens") {
        await modelHandoff(deps, c, "low_confidence", "The assistant's reply was cut off.", text, emit, res);
        c.messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result" as const, tool_use_id: u.id, is_error: true, content: "Turn ended." })) });
        break;
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        res.toolCalls.push(u.name);
        c.steps.push(u.name);
        const out = await runTool(deps, c, u, text, emit, res, used);
        if (out.card) sawUiCard = true;
        results.push({ type: "tool_result", tool_use_id: u.id, content: out.content, is_error: out.isError || undefined });
      }
      c.messages.push({ role: "user", content: results });
      // The 988 script is the whole reply; the model writes nothing after it, now or in later turns.
      if (c.selfHarm) break;
    }
  } catch (e) {
    // Roll back this turn's unanswered tail so a retry starts clean; earlier turns are untouched.
    c.messages.length = base;
    if (e instanceof Anthropic.APIUserAbortError) throw e;
    const retryable = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError;
    emit({ type: "error", code: e instanceof Anthropic.APIError ? `model_${e.status ?? "conn"}` : "server_error", retryable });
    return { ...res, outcome: "error" };
  }

  // Account answers come from the caller's records, not the knowledge base, so they carry no source chips.
  if (res.outcome === "answered" && !sawUiCard && !res.toolCalls.some((t) => t === "lookup_account" || t === "verify_caller")) {
    const seen = new Set<string>();
    const sources = [];
    // Show a passage as a source only if the answer visibly uses it (shared amounts or content words).
    const answer = answerText(c);
    for (const p of [...used].sort((a, b) => b.score - a.score).filter((p) => supports(p.text, answer))) {
      if (seen.has(p.doc)) continue;
      seen.add(p.doc);
      sources.push({ doc_title: p.doc_title, effective_date: p.effective, section: p.section });
      if (sources.length === 3) break;
    }
    if (sources.length) emit({ type: "sources", sources });
  }
  return res;
}

export function isSelfNote(p: string): boolean {
  return p.length <= 120 && !/\b(I|I'm|I'll|I've|you|your|you're|we|we're|our|Meridian|sorry|thanks|hi|hello)\b/i.test(p);
}

// Short replies to the assistant's own questions: a ZIP, a phone number and ZIP, a slot pick from the buttons, or a name.
const LOGISTICS = [/^\s*(my zip( code)? is\s*)?\d{5}\.?\s*$/i, /^[\s\d().,+-]*\d{3}[\s().-]*\d{3}[\s.-]*\d{4}\b[\s,.]*(and\s+)?(zip( code)?:?\s*)?(\d{5})?\.?\s*$|^(my )?(phone( number)?|number) is [\d\s().-]{10,16}(,? and (my )?zip( code)? is \d{5})?\.?$/i, /^I'll take .+ \(slot_id \d+\)\.$/, /^\s*(it'?s|my name is|i'?m|name'?s)?\s*[A-Z][a-z'-]+( [A-Z][a-z'-]+){0,2}\.?\s*$/];
export function isLogistics(text: string): boolean {
  return text.length <= 80 && LOGISTICS.some((r) => r.test(text));
}

function answerText(c: Conversation): string {
  const out: string[] = [];
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const m = c.messages[i];
    if (m.role === "user" && typeof m.content === "string") break;
    if (m.role === "assistant" && Array.isArray(m.content) && !m.content.some((b) => b.type === "tool_use"))
      for (const b of m.content) if (b.type === "text") out.push(b.text);
  }
  return out.join(" ");
}

const STOP = new Set("about after again their there these those which would could should where while cannot visit thanks great please today".split(" "));
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !STOP.has(w)));
const figures = (s: string) => new Set(s.match(/\$\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\b\d{2,}\b/g) ?? []);

export function supports(passage: string, answer: string): boolean {
  const fa = figures(answer);
  for (const f of figures(passage)) if (f.length > 2 && fa.has(f)) return true;
  const wa = words(answer);
  let shared = 0;
  for (const w of words(passage)) if (wa.has(w) && ++shared >= 4) return true;
  return false;
}

// Once set, the lock is one-way: no booking or change runs, and any card the caller hasn't confirmed is withdrawn.
function lockForSafety(c: Conversation, script: SafetyScript) {
  c.safetyLock = true; // the confirm routes refuse while this is set, so an unconfirmed card can't be used
  if (script === "self_harm") c.selfHarm = true;
}

async function modelHandoff(deps: Deps, c: Conversation, asked: (typeof MODEL_HANDOFF_REASONS)[number] | HandoffReason, summary: string, text: string, emit: Emit, res: TurnResult) {
  const CARD: Partial<Record<string, SafetyScript>> = { electrical: "electrical", self_harm: "self_harm", medical: "medical", threat: "threat",
    caller_in_danger: "in_danger", urgent_other: "urgent" };
  let script: SafetyScript | undefined = CARD[asked];
  if (asked === "safety") {
    const r = route(text);
    script = r.kind === "safety" ? r.script : "gas_co_fire";
  }
  // In an already locked chat a repeat handoff adds no second card; a new kind of crisis (self-harm, danger) still shows its own.
  if (c.safetyLock && (asked === "safety" || asked === "urgent_other")) script = undefined;
  // A repeat safety handoff in an already locked chat adds no second card and no second ticket.
  const reason: HandoffReason = script === "threat" || asked === "threat" ? "adversarial" : script || asked in CARD || asked === "safety" ? "safety" : (asked as HandoffReason);
  if (script) {
    lockForSafety(c, script);
    const intent = script === "gas_co_fire" ? "safety" : script;
    c.intents.push(intent);
    emit({ type: "safety", script, text: SCRIPTS[script] });
  }
  const h = c.handoff === reason ? undefined : await createHandoff(deps.db, c, reason, summary, text);
  c.handoff = reason;
  res.outcome = reason === "safety" ? "safety" : "handoff";
  res.handoffReason = reason;
  const forCaller = script ? (INTENT_SUMMARY[script] ?? INTENT_SUMMARY.urgent) : summary.slice(0, 400);
  emit({ type: "handoff", reason_enum: reason, summary_for_caller: forCaller, queue_position: h?.position });
}

async function runTool(
  deps: Deps, c: Conversation, u: Anthropic.Beta.BetaToolUseBlock, text: string, emit: Emit, res: TurnResult, used: Passage[],
): Promise<{ content: string; isError?: boolean; card?: boolean }> {
  const bad = (msg: string) => ({ content: msg, isError: true });
  switch (u.name) {
    case "search_kb": {
      const p = SearchIn.safeParse(u.input);
      if (!p.success) return bad("INVALID_INPUT");
      emit({ type: "status", phase: "searching_kb" });
      const hits = (await deps.search(p.data.query)).filter((x) => x.score >= config.minRetrievalScore);
      used.push(...hits);
      return { content: JSON.stringify(hits.map((h) => ({ id: h.id, title: h.doc_title, effective: h.effective, text: h.text }))) };
    }
    case "check_availability": {
      const p = AvailIn.safeParse(u.input);
      if (!p.success) return bad("INVALID_INPUT");
      if (c.safetyLock) return bad("Booking is not available in this conversation because of a safety concern.");
      const z = zipLookup(p.data.zip);
      if (z.kind === "unknown") return bad("That is not a valid 5-digit ZIP code. Ask the caller for it again.");
      c.caller.zip = p.data.zip.slice(0, 5);
      if (z.kind === "not_serviced") return { content: JSON.stringify({ result: "not_in_service_area", city: z.city || null }) };
      if (z.kind === "unclear") {
        await modelHandoff(deps, c, "service_area_unclear", `Caller wants a ${SERVICE_LABEL[p.data.service_type].toLowerCase()} in ${z.city} (${c.caller.zip}); ${z.why}.`, text, emit, res);
        return { content: JSON.stringify({ result: "handed_off", why: "The team needs to confirm coverage for this ZIP. Tell the caller a person will follow up." }), card: true };
      }
      emit({ type: "status", phase: "checking_availability" });
      const slots = await findSlots(deps.db, { zone: z.zone, service_type: p.data.service_type, on_or_after: p.data.on_or_after, part_of_day: p.data.part_of_day });
      if (slots.length === 0) return { content: JSON.stringify({ result: "no_openings" }) };
      for (const s of slots) c.offered.set(s.slot_id, { slot_id: s.slot_id, zone: z.zone, zip: c.caller.zip, city: z.city, service_type: p.data.service_type, date: s.date, window: s.window });
      emit({ type: "slots", slots: slots.map(slotEvent) });
      res.outcome = "slots_offered";
      return { content: JSON.stringify({ result: "shown_to_caller", options: slots.map((s) => ({ slot_id: s.slot_id, when: whenLabel(s.date, s.window) })) }), card: true };
    }
    case "propose_booking": {
      const p = ProposeIn.safeParse(u.input);
      if (!p.success) return bad("INVALID_INPUT");
      if (c.safetyLock) return bad("Booking is not available in this conversation because of a safety concern.");
      const o = c.offered.get(p.data.slot_id);
      if (!o) return bad("That slot_id was not offered in this conversation. Call check_availability first.");
      const still = await isSlotAvailable(deps.db, o.slot_id, o.zone, o.service_type);
      if (!still) {
        const next = await findSlots(deps.db, { zone: o.zone, service_type: o.service_type });
        for (const s of next) c.offered.set(s.slot_id, { ...o, slot_id: s.slot_id, date: s.date, window: s.window });
        emit({ type: "booking_failed", reason: "slot_taken", slots: next.map(slotEvent) });
        return { content: JSON.stringify({ result: "slot_taken", new_options_shown: next.length }), card: true };
      }
      c.caller.name = p.data.caller_name.trim();
      c.pending = { session_id: c.sessionId, slot_id: o.slot_id, zone: o.zone, zip: o.zip, city: o.city, service_type: o.service_type,
        name: c.caller.name, issue: p.data.issue_summary };
      emit({ type: "status", phase: "booking" });
      emit({ type: "confirm_request", service: SERVICE_LABEL[o.service_type], slot_id: o.slot_id, when_label: whenLabel(o.date, o.window),
        zip: o.zip, name: c.caller.name, fee_label: FEE_LABEL[o.service_type] });
      res.outcome = "confirm_shown";
      return { content: JSON.stringify({ result: "confirm_card_shown", note: "Not booked yet. The caller must press Confirm." }), card: true };
    }
    case "verify_caller": {
      const p = VerifyIn.safeParse(u.input);
      if (!p.success) return bad("INVALID_INPUT");
      if (c.verified) return { content: JSON.stringify({ result: "already_verified", first_name: c.verified.firstName }) };
      // Three tries per conversation and ten per session per hour, so the tool can't be used to search for accounts.
      if (c.verifyAttempts >= 3 || !allow(`verify:${c.sessionId}`, 10, 3_600_000).ok)
        return { content: JSON.stringify({ result: "locked", note: "Too many attempts. Offer to pass the caller to a person (handoff reason out_of_scope)." }) };
      c.verifyAttempts++;
      const v = await verifyCaller(deps.db, p.data.phone, p.data.zip);
      if (!v) return { content: JSON.stringify({ result: "no_match", attempts_left: 3 - c.verifyAttempts, note: "Don't say which part didn't match." }) };
      const z = zipLookup(v.zip);
      c.verified = { ...v, zone: z.kind === "zone" ? z.zone : null };
      c.caller.zip = v.zip;
      c.caller.name = v.firstName;
      return { content: JSON.stringify({ result: "verified", first_name: v.firstName, zip: v.zip }) };
    }
    case "lookup_account": {
      const p = LookupIn.safeParse(u.input);
      if (!p.success) return bad("INVALID_INPUT");
      if (!c.verified) return bad("Not verified. Ask for the phone number on the account and the service ZIP code, then call verify_caller.");
      return { content: JSON.stringify(await lookupAccount(deps.db, c.verified.customerId, p.data.topic)) };
    }
    case "propose_appointment_change": {
      const p = ChangeIn.safeParse(u.input);
      if (!p.success) return bad("INVALID_INPUT");
      if (!c.verified) return bad("Not verified. Call verify_caller first.");
      if (c.safetyLock) return bad("Appointment changes are not available in this conversation because of a safety concern.");
      const appt = (await upcomingAppointments(deps.db, c.verified.customerId)).find((a) => a.appointment_id === p.data.appointment_id);
      if (!appt) return bad("That appointment_id is not one of this caller's upcoming appointments. Call lookup_account first.");
      let newWhen: string | undefined;
      if (p.data.action === "reschedule") {
        const o = c.offered.get(p.data.new_slot_id);
        if (!o) return bad("That new_slot_id was not offered in this conversation. Call check_availability first, with the appointment's service_type and the caller's ZIP.");
        // Zone comes from the caller's ZIP (check_availability), not the old slot: the mock data's slot zones don't follow customer addresses.
        if (o.service_type !== appt.service_type) return bad(`The new time must be for the same service_type as the appointment (${appt.service_type}). Call check_availability again with service_type ${appt.service_type}.`);
        const still = await isSlotAvailable(deps.db, o.slot_id, o.zone, o.service_type);
        if (!still) return { content: JSON.stringify({ result: "slot_taken", note: "Call check_availability again." }) };
        newWhen = whenLabel(o.date, o.window);
      }
      c.pendingChange = { session_id: c.sessionId, customer_id: c.verified.customerId, appointment_id: appt.appointment_id, action: p.data.action,
        new_slot_id: p.data.action === "reschedule" ? p.data.new_slot_id : undefined, service_type: appt.service_type,
        zone: p.data.action === "reschedule" ? c.offered.get(p.data.new_slot_id)!.zone : appt.zone };
      const fee = lateFee(appt.start_utc);
      emit({ type: "change_request", action: p.data.action, appointment_id: appt.appointment_id, service: SERVICE_LABEL[appt.service_type],
        current_when: whenLabel(appt.date, appt.window), new_when: newWhen, new_slot_id: p.data.action === "reschedule" ? p.data.new_slot_id : undefined,
        fee_label: fee ?? "No fee (more than 24 hours before the window)" });
      res.outcome = "change_shown";
      return { content: JSON.stringify({ result: "confirm_card_shown", late_fee: fee, note: "Nothing has changed yet. The caller must press Confirm." }), card: true };
    }
    case "handoff": {
      const p = HandoffIn.safeParse(u.input);
      if (!p.success) return bad("INVALID_INPUT");
      await modelHandoff(deps, c, p.data.reason, p.data.summary, text, emit, res);
      return { content: JSON.stringify({ result: "handed_off", note: "Tell the caller in one short sentence that a person will follow up." }), card: true };
    }
    default:
      return bad("Unknown tool.");
  }
}
