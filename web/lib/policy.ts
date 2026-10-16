// Deterministic routing that runs before the model on every caller message. Safety constraints are one-way:
// nothing the model says can turn a safety or handoff decision back into a booking.
export type HandoffReason =
  | "safety" | "billing_account" | "cancel_reschedule" | "complaint" | "human_requested"
  | "low_confidence" | "service_area_unclear" | "booking_failed" | "out_of_scope" | "adversarial";

export type Route =
  | { kind: "safety"; script: "gas_co_fire" | "self_harm"; intent: string }
  | { kind: "handoff"; reason: HandoffReason; intent: string }
  | { kind: "deflect"; script: "injection"; intent: string }
  | { kind: "model" };

const t = (s: string) => new RegExp(s, "i");

const SAFETY: [RegExp, Route & { kind: "safety" }][] = [
  [t(String.raw`\b(kill (myself|me)|suicid|end my life|hurt myself|self[- ]harm|don'?t want to (live|be alive))`), { kind: "safety", script: "self_harm", intent: "self_harm" }],
  [t(String.raw`\b(smell(s|ing)? (of |like )?(gas|natural gas|propane|rotten eggs?)|gas (smell|leak|odor)|leaking gas|hiss(ing)? .*gas)`), { kind: "safety", script: "gas_co_fire", intent: "gas_leak" }],
  [t(String.raw`\b(carbon monoxide|co (alarm|detector|monitor)|co2? detector (is )?(going off|beeping|alarm))`), { kind: "safety", script: "gas_co_fire", intent: "carbon_monoxide" }],
  [t(String.raw`\b(spark(s|ing)?|smok(e|ing|y)|flames?|on fire|caught fire|electrical fire)\b`), { kind: "safety", script: "gas_co_fire", intent: "sparks_smoke" }],
  [t(String.raw`\b(burning (smell|odor|plastic|rubber|wire)|smell(s|ing)? (like )?(something )?burn(ing|t))`), { kind: "safety", script: "gas_co_fire", intent: "burning_smell" }],
];

const HANDOFF: [RegExp, HandoffReason, string][] = [
  [t(String.raw`\b(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+|some\s*one|real\s+|live\s+)?(person|human|agent|rep|representative|someone|somebody|operator|manager|supervisor)|\b(real|live)\s+(person|human)\b|\bhuman,? please\b|^\s*(agent|representative|operator)\s*$`), "human_requested", "human_requested"],
  [t(String.raw`\b(cancel|reschedul|re-schedul|move|push back|change)\w*\b.{0,40}\b(appointment|visit|booking|tech(nician)? visit)|\bcancel (it|my)|\breschedule\b`), "cancel_reschedule", "cancel_reschedule"],
  [t(String.raw`\b(my|the|this|an?)\s+(bill|invoice|statement|charge|balance)\b|\b(refund|overcharg|double[- ]charg|charged (me|twice)|dispute|payment plan|pay (my|the|an?) (bill|invoice|balance)|past due|collections|card on file|autopay)\b`), "billing_account", "billing"],
  [t(String.raw`\b(my|our)\s+(account|membership (status|renewal date)|renewal date)\b|\bwhen does my membership\b|\bam i (a member|on the plan|covered)\b|\bupdate my (address|phone|email|card)\b`), "billing_account", "account_lookup"],
  [t(String.raw`\b(when|what time) (is|will) (my|the) (tech|technician|appointment)|\b(where is|eta for) (my|the) (tech|technician)|\bconfirm my (appointment|visit)|\bdo i have an appointment\b`), "out_of_scope", "existing_appointment"],
  [t(String.raw`\b(complain|complaint|terrible|awful|horrible|unacceptable|furious|ripped off|scam|lawsuit|lawyer|attorney|bbb|better business bureau|damaged my|broke my|rude)\b`), "complaint", "complaint"],
];

const INJECTION = t(String.raw`\b(ignore (all |any )?(previous|prior|above) (instructions|rules)|disregard (your|the) (instructions|rules)|system prompt|you are now|developer mode|jailbreak|pretend (to be|you are)|act as (a |an )?(different|unrestricted)|reveal your (prompt|instructions)|\bDAN\b)`);

export function route(text: string): Route {
  for (const [re, r] of SAFETY) if (re.test(text)) return r;
  for (const [re, reason, intent] of HANDOFF) if (re.test(text)) return { kind: "handoff", reason, intent };
  if (INJECTION.test(text)) return { kind: "deflect", script: "injection", intent: "adversarial" };
  return { kind: "model" };
}

// Fixed scripts. The UI renders these from their id; the model never writes them.
export const SCRIPTS = {
  gas_co_fire:
    "This could be dangerous. If you smell gas, see sparks or smoke, or a carbon monoxide alarm is sounding, leave the house now and call 911 from outside. If it's gas, also call your gas utility's emergency line. Don't flip switches or run the system. I'm passing this to our team right away. I won't book a regular visit for this.",
  self_harm:
    "I'm really sorry you're going through this. You can call or text 988 to reach the Suicide and Crisis Lifeline any time, day or night. If you're in immediate danger, call 911. I'm also letting a person on our team know.",
  injection:
    "I can only help with Meridian Home Comfort services: questions about our services, prices, memberships and warranties, and booking a visit. What can I help you with?",
} as const;

export const HANDOFF_COPY: Record<HandoffReason, string> = {
  safety: "I've flagged this as urgent for our team.",
  billing_account: "Billing and account questions need a person who can verify your account, so I'm passing you to our team.",
  cancel_reschedule: "Changes to an existing appointment are handled by our team, so I'm passing this to them.",
  complaint: "I'm sorry about this. I'm passing it to a person on our team who can look into it properly.",
  human_requested: "Sure, I'm connecting you with a person on our team.",
  low_confidence: "I don't want to guess on this one, so I'm passing it to a person on our team.",
  service_area_unclear: "I can't confirm we cover that address, so I'm passing this to our team to check.",
  booking_failed: "I couldn't complete the booking, so I'm passing this to our team to finish it.",
  out_of_scope: "That needs someone who can look up your records, so I'm passing it to our team.",
  adversarial: "I'm passing this conversation to our team.",
};
