import { z } from "zod";

// The chat stream protocol (UI spec section 3). Every event is validated before it is written.
export const Slot = z.object({ slot_id: z.number().int(), date: z.string(), window_label: z.string(), tz: z.literal("America/Chicago") });
export const HandoffReasonSchema = z.enum(["safety", "billing_account", "cancel_reschedule", "complaint", "human_requested",
  "low_confidence", "service_area_unclear", "booking_failed", "out_of_scope", "adversarial"]);

export const AgentEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), phase: z.enum(["searching_kb", "checking_availability", "booking"]) }),
  z.object({ type: z.literal("text_delta"), text: z.string() }),
  // Drop the last `chars` characters of streamed text: words written just before a tool call are not meant for the caller.
  z.object({ type: z.literal("text_discard"), chars: z.number().int().nonnegative() }),
  z.object({ type: z.literal("sources"), sources: z.array(z.object({ doc_title: z.string(), effective_date: z.string().nullable(), section: z.string() })).max(3) }),
  z.object({ type: z.literal("slots"), slots: z.array(Slot).max(4) }),
  z.object({ type: z.literal("confirm_request"), service: z.string(), slot_id: z.number().int(), when_label: z.string(), zip: z.string(), name: z.string(), fee_label: z.string() }),
  z.object({ type: z.literal("booked"), ref: z.string(), when_label: z.string(), tz: z.string(), service: z.string(), tech_first_name: z.string() }),
  z.object({ type: z.literal("booking_failed"), reason: z.enum(["slot_taken", "cap_reached", "error"]), slots: z.array(Slot).max(4) }),
  z.object({ type: z.literal("change_request"), action: z.enum(["cancel", "reschedule"]), appointment_id: z.number().int(), service: z.string(),
    current_when: z.string(), new_when: z.string().optional(), new_slot_id: z.number().int().optional(), fee_label: z.string() }),
  z.object({ type: z.literal("changed"), action: z.enum(["cancel", "reschedule"]), ref: z.string(), when_label: z.string(), old_when_label: z.string(), service: z.string() }),
  z.object({ type: z.literal("handoff"), reason_enum: HandoffReasonSchema, summary_for_caller: z.string(), queue_position: z.number().int().optional() }),
  z.object({ type: z.literal("safety"), script: z.enum(["gas_co_fire", "self_harm", "medical", "electrical", "threat", "domestic_violence", "urgent"]), text: z.string() }),
  z.object({ type: z.literal("error"), code: z.string(), retryable: z.boolean() }),
  z.object({ type: z.literal("done"), turn_id: z.string(), latency_ms: z.number() }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
export type Emit = (e: AgentEvent) => void;
