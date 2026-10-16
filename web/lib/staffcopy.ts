// Display copy for the staff console. Labels only; no caller text.
export const REASON_LABEL: Record<string, string> = {
  safety: "Safety", billing_account: "Billing or account", cancel_reschedule: "Cancel or reschedule", complaint: "Complaint",
  human_requested: "Asked for a person", low_confidence: "Low confidence", service_area_unclear: "Service area unclear",
  booking_failed: "Booking failed", out_of_scope: "Out of scope", adversarial: "Adversarial",
};

// Why the handoff reached a person, stated as the rule that sent it.
export const REASON_WHY: Record<string, string> = {
  safety: "Safety concern. Policy: the safety script is shown first and a person always follows up.",
  billing_account: "Billing or account question. Policy: anything that needs account records goes to a person.",
  cancel_reschedule: "Change to an existing appointment. Policy: cancellations and reschedules go to a person.",
  complaint: "Complaint about a visit or service. Policy: complaints always go to a person.",
  human_requested: "The caller asked for a person. Policy: that request is always honored.",
  low_confidence: "The knowledge base did not clearly answer the question, so the assistant did not guess.",
  service_area_unclear: "The ZIP is in an area our documents disagree on, so a person confirms coverage.",
  booking_failed: "The booking could not be completed after a retry.",
  out_of_scope: "The request needs records the assistant cannot see.",
  adversarial: "The conversation tried to misuse the assistant.",
};

const INTENT_TITLE: Record<string, string> = {
  gas_leak: "Possible gas smell", carbon_monoxide: "Carbon monoxide alarm", sparks_smoke: "Sparks or smoke", burning_smell: "Burning smell",
  self_harm: "Caller in crisis", human_requested: "Asked for a person", cancel_reschedule: "Wants to change an appointment",
  billing: "Question about a bill or charge", account_lookup: "Needs account records", existing_appointment: "Asking about an existing appointment",
  complaint: "Concern about a past visit",
};

export function handoffTitle(reason: string, intent: string | null): string {
  return (intent && INTENT_TITLE[intent]) || REASON_LABEL[reason] || reason.replace(/_/g, " ");
}

export function waitingLabel(from: Date, to = new Date()): string {
  const m = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

// Short opaque label for a session id (never the raw id).
export function shortId(id: string | null): string {
  return id ? `s_${id.slice(0, 6)}` : "–";
}
