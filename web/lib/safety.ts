import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "./config";
import { emptyUsage, type Usage } from "./pricing";
import type { SafetyScript } from "./policy";

// A second, independent safety check on every caller message the strong rules didn't already lock. It answers one question:
// is there a real danger here, and is a scary word just an idiom or a name? It can add a lock but never remove one.
const Verdict = z.object({
  category: z.enum(["none", "gas_fire_smoke_co", "electrical", "water_heater", "self_harm", "medical", "threat_by_caller", "caller_in_danger",
    "domestic_violence", "other_emergency"]),
  figurative_or_name: z.boolean(),
});
export type Verdict = z.infer<typeof Verdict>;

export const VERDICT_INTENT: Record<Exclude<Verdict["category"], "none">, string> = {
  gas_fire_smoke_co: "safety", electrical: "electrical", water_heater: "water_heater_hazard", self_harm: "self_harm", medical: "medical",
  threat_by_caller: "threat", caller_in_danger: "in_danger", domestic_violence: "domestic_violence", other_emergency: "urgent",
};
export const VERDICT_SCRIPT: Record<Exclude<Verdict["category"], "none">, SafetyScript> = {
  gas_fire_smoke_co: "gas_co_fire", electrical: "electrical", water_heater: "urgent", self_harm: "self_harm", medical: "medical",
  threat_by_caller: "threat", caller_in_danger: "in_danger", domestic_violence: "domestic_violence", other_emergency: "urgent",
};

const SYSTEM = `You screen messages sent to the customer chat of a home heating, cooling and plumbing company. Classify the caller's latest message.

category: the kind of real, present danger the message reports or suggests, or "none".
- gas_fire_smoke_co: gas or propane smell, fire, flames or smoke from something, a burning smell, a carbon monoxide alarm or symptoms.
- electrical: shocks, sparking or arcing, scorched or melted outlets or wiring, water on a panel or outlets.
- water_heater: a water heater or tank bulging, banging hard while leaking, a relief valve spraying, scalding water.
- self_harm: the caller may hurt or kill themselves, wants to die, says goodbye, or hints at it ("I won't be around", "no way out"), in any language.
- medical: someone needs emergency care now (fainted, can't breathe, chest pain, unresponsive, a baby or elderly person in danger from heat or cold).
- threat_by_caller: the caller threatens to hurt someone.
- caller_in_danger: someone is threatening, attacking or breaking in on the caller.
- domestic_violence: a partner or family member is hurting or threatening the caller.
- other_emergency: any other present danger to a person.
Ordinary equipment problems (no heat, no cooling, a leak, a noise, a part question, a price question about detectors) are "none". So are past events that are over and questions about safety devices.

figurative_or_name: true when every danger-sounding word in the message is an idiom, a joke, a name, or about equipment rather than a person ("my wife will kill me", "this heat is killing me", "the compressor is dying", "Kat Smoke"). When in doubt about whether a person may be in danger, choose the danger category and false.`;

// verdict is null when the check could not run (two failed attempts, 8 seconds each). The caller then fails closed.
export async function classifySafety(anthropic: Anthropic, text: string, lastAssistant: string | undefined, signal?: AbortSignal): Promise<{ verdict: Verdict | null; usage: Usage }> {
  const usage = emptyUsage();
  const content = `${lastAssistant ? `The assistant's previous message: <assistant>${lastAssistant.slice(0, 600)}</assistant>\n` : ""}The caller's latest message: <caller>${text}</caller>`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await anthropic.messages.parse(
        { model: config.safetyModel, max_tokens: 200, system: SYSTEM, messages: [{ role: "user", content }], output_config: { format: zodOutputFormat(Verdict) } },
        { signal, timeout: 8_000, maxRetries: 0 },
      );
      usage.input += r.usage.input_tokens; usage.output += r.usage.output_tokens;
      if (r.parsed_output) return { verdict: r.parsed_output, usage };
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError) throw e;
    }
  }
  return { verdict: null, usage };
}

// The classifier's verdict as a lock decision: a hazard it reports locks, unless it judged the scary words figurative.
export const verdictLocks = (v: Verdict) => v.category !== "none" && !v.figurative_or_name;
