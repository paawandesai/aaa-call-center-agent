// Deterministic routing that runs before the model on every caller message. Safety constraints are one-way:
// nothing the model says can turn a safety or handoff decision back into a booking.
export type HandoffReason =
  | "safety" | "billing_account" | "cancel_reschedule" | "complaint" | "human_requested"
  | "low_confidence" | "service_area_unclear" | "booking_failed" | "out_of_scope" | "adversarial";

export type Route =
  | { kind: "safety"; script: SafetyScript; intent: string; tier?: "weak" }
  | { kind: "handoff"; reason: HandoffReason; intent: string }
  | { kind: "deflect"; script: "injection" | "ai_disclosure"; intent: string }
  | { kind: "model" };

import { zipLookup } from "./zones";

const t = (s: string) => new RegExp(s, "i");

export type SafetyScript = "gas_co_fire" | "self_harm" | "medical" | "electrical" | "threat" | "domestic_violence" | "in_danger" | "urgent";
const SAFETY: [RegExp, Route & { kind: "safety" }][] = [
  // Self-harm first, so "...unalive myself, horrible week" never reaches the complaint route. First-person forms, so
  // "this heat is killing me" or "the compressor is going to die" stay out; a false positive gets a kind 988 message.
  [t(String.raw`\b(kill(ing)? myself|kms\b|suicid\w*|end(ing)? (my|it) (own )?life|end(ing)? it all|take (my|my own) life|(hurt(ing)?|harm(ing)?|cut(ting)?|off(ing)?|hang(ing)?|shoot(ing)?|poison(ing)?|starv(e|ing)) myself|(nobody|no one) would (even )?(miss|care about) me|jump(ing)? off (a |the |my )?(\w+ )?(bridge|building|roof|balcony|overpass)|ya no quiero vivir|no quiero (vivir|seguir viviendo)|kil+ my ?s[el]+f|(want|wanna) (to )?dye\b|goodbye (letters?|notes?)|suicide note|swallow\w* (the|a|all|my|that) (whole )?(bottle|pills|meds)|self[- ]?harm|i('?m| am)? (just )?(want|wanna|ready) (to )?die\b|i wish i (was|were) dead|(i'?d|i would) be better off dead|better off without me|don'?t want to (live|be alive|be here anymore|wake up)|(sleep|go to sleep) and not wake up|no (point|reason) (in |to )?(living|live|being alive|going on)|point of living|not worth living|(take|taking|swallow\w*) (all )?(of )?(my|the|these) (pills|meds)|overdos\w*|unalive|quiero morir|me quiero matar|suicidarme|matarme)`), { kind: "safety", script: "self_harm", intent: "self_harm" }],
  [t(String.raw`\b(my |the )?(husband|wife|boyfriend|girlfriend|partner|ex|spouse)\b[^.?!]{0,40}\b(hits?|hitting|beats?|beating|hurts?|chok\w*|abus\w*|threaten\w*)\s+me\b|\bthrow(ing|s)? (things|stuff) at me\b|\bdomestic (violence|abuse)\b|\b(hits|beats|abuses) me\b`), { kind: "safety", script: "domestic_violence", intent: "domestic_violence" }],
  // A threat made TO the caller: they get the 911 script, never the card for people who make threats.
  [t(String.raw`\b(threaten\w*|attack\w*|chas\w*|stalk\w*|following|pointing (a|his|her) (gun|knife) at)\s+me\b|\b(someone|somebody|a man|a guy|a woman|my neighbou?r|a stranger|he|she|they)\b[^.?!]{0,40}\b(broke in|breaking in|has a (gun|knife|weapon)|with a (gun|knife|weapon))\b|\b(break-?in|intruder|home invasion)\b|\b(he|she|they|someone|somebody|my (husband|wife|boyfriend|girlfriend|partner|ex|neighbou?r|roommate))\s*('?s|'?re| is| are| will)?\s*(going to|gonna|trying to|about to|threaten\w* to)\s+(kill|hurt|shoot|stab) me\b|\bi'?m (scared|afraid) (for my life|he|she|they)\b`), { kind: "safety", script: "in_danger", intent: "in_danger" }],
  [t(String.raw`\b(put a bullet in|stab|beat|punch|strangle|choke|hurt|kill)\s+(him|her|them|the tech\w*|your tech\w*|that tech\w*|someone|somebody|whoever)\b|\b(he'?s|she'?s|you'?re|they'?re) (dead|gonna die)\b|\bloaded gun\b|\b(gun|knife|weapon|shotgun|rifle)\b[^.?!]{0,40}\b(tech|him|her|door)\b|\bgonna hurt someone\b|\bgoing to hurt someone\b|\bi (have|got|own) a (gun|knife|weapon|shotgun|rifle)\b|\b(waiting|be waiting|meet (him|them)) with (my|a) (gun|shotgun|rifle|bat|knife)\b|\b(won'?t|not|never) (walk|make it|get) out (of here )?alive\b|\bi'?ll (stab|kill|hurt) (him|her|them|you|the tech\w*)\b`), { kind: "safety", script: "threat", intent: "threat" }],
  [t(String.raw`\b(passed out|unconscious|unresponsive|not breathing|can'?t breathe|trouble breathing|hard to breathe|struggling to breathe|stopped sweating|heat ?stroke|lethargic|seizures?|chest pains?|fainted|collapsed|turning blue|se desmay\w*|no respira|inconsciente|feel(ing)? faint|about to pass out)\b|\bpregnant\b[^.?!]{0,40}\b(overheat\w*|faint|dizzy)\b|\bbeb[eé].{0,30}\b(mucho|muy) (fr[ií]o|calor)`), { kind: "safety", script: "medical", intent: "medical" }],
  [t(String.raw`\b(smel+(s|ing|ed)?|odou?r|stinks?)\b[^.?!]{0,30}\b(gas|natural gas|propane|rotten eggs?|sulfur|sulphur)\b|\b(gas|propane|sulfur|sulphur)\b[^.?!]{0,30}\b(smell|odou?r|leak\w*|smells funny)\b|\brotten eggs?\b|\bleaking gas\b|\bhiss\w*\b[^.?!]{0,40}\bgas\b|\bgas (line|meter|pipe|valve)\b[^.?!]{0,30}\bhiss\w*|\bhuele a gas\b|\bfuga de gas\b|\bpilot( light)?\b[^.?!]{0,30}\bsmell\w*|\b(stove|burner|oven|range)\b[^.?!]{0,30}\b(left on|on all night|unlit|not lit|won'?t light)\b[^.?!]{0,40}\bgas\b|\bgas (stove|burner|oven|range)\b[^.?!]{0,30}\b(left on|unlit|not lit|on all night)\b`), { kind: "safety", script: "gas_co_fire", intent: "gas_leak" }],
  [t(String.raw`\b(carbon mon[oi]xide|mon[oó]xido( de carbono)?|co2?)\s+(alarm|detector|monitor)s?\b[^.?!]{0,30}\b(going off|goes off|went off|beep\w*|sound\w*|sonando|alarm\w*|chirp\w*|keeps|is (red|flashing))|\bcarbon mon[oi]xide\b[^.?!]{0,30}\b(leak\w*|poison\w*|symptoms?|in (my|the) (house|home))|\b(alarma|detector) de mon[oó]xido|\bcarbon mon[oi]xide alarm\b|\b(headaches?|dizz(y|iness)|nause\w*|throwing up|vomit\w*|head is pounding|light-?headed)\b[^.?!]{0,80}\b(furnace|heater|heat|boiler|stove|alarm)\b|\b(furnace|heater|boiler)\b[^.?!]{0,80}\b(headaches?|dizz(y|iness)|nause\w*|throwing up|vomit\w*)\b|\balarm\b[^.?!]{0,40}\b(chirp\w*|beep\w*|going off)\b[^.?!]{0,60}\b(throwing up|vomit\w*|dizzy|headaches?|sick)\b|\bflames? (look|are|is|burn\w*) (yellow|orange)\b`), { kind: "safety", script: "gas_co_fire", intent: "carbon_monoxide" }],
  [t(String.raw`\bwater\b[^.?!]{0,50}\b(electrical panel|breaker (box|panel)|outlets?|panel|wiring)\b|\b(panel|breaker box|outlet)\b[^.?!]{0,30}\b(smells? (hot|like burning)|is hot|wet|sparking)\b|\b(zapp\w*|shock(s|ed|ing)? me|got shocked|electrocut\w*|arcing|melted|scorch\w*)\b|\b(outlet|wires?|wiring|panel|breaker)\b[^.?!]{0,30}\b(buzz\w*|black(ened)?|burn(ed|t)|too hot|is hot|hot to the touch)\b|\b(outlets?|panel|breaker( box| panel)?|wires?|wiring|switch|plug)\b[^.?!]{0,30}\bsparked\b|\bsparked\b[^.?!]{0,20}\b(at|from|in|out of|behind) (the |my |a )?(outlet|panel|breaker|wall|switch|plug)\b`), { kind: "safety", script: "electrical", intent: "electrical" }],
  [t(String.raw`\b(water heater|tank)\b[^.?!]{0,40}\b(bang\w*|explod\w*|bulg\w*|rumbl\w*[^.?!]{0,30}\bleak\w*)|\brelief valve\b[^.?!]{0,30}\b(spray\w*|blow\w*|hiss\w*|gush\w*)`), { kind: "safety", script: "urgent", intent: "water_heater_hazard" }],
  [t(String.raw`\b(sparking|sparks? (are )?(flying|coming|shooting)|(see|seeing|saw|smell|smelling|smelled) (some )?smoke|smoke (is )?(coming|pouring|filling)|smoking (from|out of|unit|outlet|panel|furnace|vent)|flames (are )?(coming|shooting)|on fire|caught fire|electrical fire|smoke alarm (is )?(going off|sounding))\b`), { kind: "safety", script: "gas_co_fire", intent: "sparks_smoke" }],
  [t(String.raw`\b(burning (smell|odor|plastic|rubber|wire)|smell(s|ing)? (like )?(something )?burn(ing|t)|chemical smell\b[^.?!]{0,40}\b(eyes|burn))`), { kind: "safety", script: "gas_co_fire", intent: "burning_smell" }],
];

// Ambiguous words: they lock only when the safety classifier (lib/safety.ts) confirms a real hazard, because idioms
// ("my wife will kill me", "I'm gonna die in this heat") and names ("Kat Smoke") use them too.
const WEAK: [RegExp, Route & { kind: "safety" }][] = [
  [t(String.raw`\b((just|please|somebody|someone|they'?ll|she'?ll|he'?ll|will) kill me|i can'?t (go on|do this)( any ?more)?|i won'?t be (alive|around|here)|i'?m done with (everything|life|it all)|no way out|(see|find) a way out|everyone would be better off|end(ing)? things|(going|gonna) (to )?die)\b`), { kind: "safety", script: "self_harm", intent: "self_harm", tier: "weak" }],
  [t(String.raw`\b(baby|infant|newborn|toddler|child|kid|mom|mother|dad|father|grand\w*|elderly|husband|wife|son|daughter)\b[^.?!]{0,60}\b(confused|disoriented|shivering|limp|won'?t wake)\b`), { kind: "safety", script: "medical", intent: "medical", tier: "weak" }],
  // "shoot" is also "shoot you a photo" or "shoot him an email".
  [t(String.raw`\b(i'?ll |gonna |going to |i will )?shoot (him|her|them|you|the tech\w*|your tech\w*|that tech\w*|someone|somebody|whoever)\b`), { kind: "safety", script: "threat", intent: "threat", tier: "weak" }],
  [t(String.raw`\bbanging on (the|my) (bedroom |front |bathroom )?door\b`), { kind: "safety", script: "in_danger", intent: "in_danger", tier: "weak" }],
  [t(String.raw`\bscald\w*`), { kind: "safety", script: "urgent", intent: "water_heater_hazard", tier: "weak" }],
  [t(String.raw`\b(spark(s|ed|ing)?|smok(e|ing|y)|flames?)\b`), { kind: "safety", script: "gas_co_fire", intent: "sparks_smoke", tier: "weak" }],
];

// Everyday HVAC phrases that contain a safety word but aren't a hazard. They are blanked out before the safety match only.
const NOT_HAZARD = t(String.raw`\bsmoke (detector|alarm)s?\b[^.?!]{0,40}\b(chirp\w*|low batter\w*|batter(y|ies))\b|\b(chirp\w*|low batter\w*|batter(y|ies))\b[^.?!]{0,40}\bsmoke (detector|alarm)s?\b|\bflame sensor\b|\b(don'?t|do not|never) smoke\b|\bnon-?smok\w*\b|\bsmoking hot\b|\bspark plugs?\b|\b(igniter|ignitor|pilot( light)?|spark igniter)\b[^.?!]{0,25}\bspark(s|ed|ing)?\b|\b(pilot( light)?|burner) (flame )?(won'?t|keeps?|goes|went|doesn'?t)( stay)?( going)? ?(lit|on|out)\b|\bflame (won'?t|keeps?|goes|went|doesn'?t)( stay)?( going)? ?(lit|on|out)\b|\b(install\w*|price|cost|quote|buy|sell|replace|add)\b[^.?!]{0,30}\b(co|carbon monoxide|smoke) (detector|alarm)s?\b|\b(co|carbon monoxide|smoke) (detector|alarm)s?\b[^.?!]{0,30}\b(install\w*|price|cost|quote)\b`);
const forSafety = (text: string) => text.replace(new RegExp(NOT_HAZARD.source, "gi"), " ");

const HANDOFF: [RegExp, HandoffReason, string][] = [
  [t(String.raw`\b(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+)?(real\s+|live\s+|actual\s+)?(person|human|agent|rep|representative|someone|somebody|operator|manager|supervisor)|\b(want|need|get|give|have)\s+(me\s+)?(a\s+|an\s+)?(real\s+|live\s+|actual\s+)?(human|person|representative|operator|manager|supervisor)\b(?!\s+(to\s+)?(come|look|fix|check|out|over|here|there))|\btransfer\s+(me|us)\b|\bconnect\s+me\s+(to|with)\s+(a\s+|an\s+)?(real\s+|live\s+)?(person|human|representative|rep|agent|operator|someone|somebody|manager|supervisor)\b|\b(human|person|someone|somebody)\s+(i|we)\s+can\s+(talk|speak|chat)\b|\b(human|person|representative|operator|agent),?\s+please\b|^\s*(an?\s+)?(real\s+|live\s+)?(agent|representative|rep|operator|human|person)[.!]*\s*$|\bconnect me (to|with) customer service\b|\b(talk|speak) to (ur|your|the) (manager|supervisor|boss)\b|\bget me (a |an |the |your )?(real |live )?(person|human|manager|supervisor|representative|rep)\b|\bget me (someone|somebody)\b(?!\s+(out|over|here|there|to come|tomorrow|today))|\b(real|live) (person|human),? (now|please)\b|\b(quiero|puedo|necesito) hablar con (una persona|alguien|un humano|un agente|un representante)\b|\bthis bot\b[^.?!]{0,20}\b(useless|stupid|worthless|isn'?t helping)\b|\b(stupid|useless|dumb) bot\b|\bbot is (useless|stupid|worthless)\b|\b(human|person|someone|somebody|rep|representative) (call|text|phone) me( back)?\b|\bput me through\b|\b(anyone|anybody|someone|somebody) (there )?(i|we) can (actually )?(talk|speak)\b|\bnecesito hablar con\b|^\W*(not a (bot|robot)\W+)?(an? )?(real |actual |live )?(person|human)\W*$`), "human_requested", "human_requested"],
  // Verified callers can look up appointments, invoices and renewal dates and move or cancel visits (tools, with a confirm
  // card). Membership cancellations, payments, disputes, refunds and account edits still go to a person.
  [t(String.raw`\bcancel\w*\b.{0,30}\b(membership|comfort club|maintenance plan|auto-?renew\w*)\b`), "billing_account", "membership_cancel"],
  [t(String.raw`\b(refund\w*|over-?charg\w*|double[- ]?charg\w*|charged (me )?twice|two .{0,20}charges|disput\w*|payment plan|pay (my |the |an? )?(bill|invoice|balance)|past due|collections|card on file|autopay|auto-pay|not what i agreed|money back|charge-? ?backs?|reimburs\w*|compensat\w*)\b|\bbilled for\b.{0,40}\bnever (happened|came|showed)|\bquoted me\b.{0,60}\b(invoice|bill)\b`), "billing_account", "billing"],
  [t(String.raw`\bupdate my (address|phone|email|card)\b|\b(did|have|has) (you|y'all|you guys|anyone|meridian) (\w+ )?register|\b(unit|system|equipment) (is |was |got )?registered\b`), "billing_account", "account_lookup"],
  [t(String.raw`\bmy window was\b|\bnobody'?s (here|come|shown up|called)\b|\b(no one|nobody) (has )?(came|come|showed|shown) up\b|\b(where is|eta for) (my|the) (tech|technician)\b|\btech(nician)? (never|didn'?t) (show|come)`), "out_of_scope", "tech_late"],
  [t(String.raw`\b(complain\w*|lawy\w*|sue (you|meridian)|small claims|scratched my|damaged? (my|our)|terrible|awful|horrible|unacceptable|furious|ripped off|scam|lawsuit|lawyer|attorney|bbb|better business bureau|damaged my|broke my|rude)\b`), "complaint", "complaint"],
];

export const isAnswerTurn = (text: string) => BARE_NAME.test(text) || /^\s*(my zip( code)? is\s*)?\d{5}\.?\s*$/i.test(text);
const BARE_NAME = /^\s*([Mm]y name is |[Nn]ame'?s )?[A-Z][a-z'-]+( [A-Z][a-z'-]+){0,2}\.?\s*$/;
const NO_HUMAN = t(String.raw`\b(don'?t|do not|no need to|never)\s+(want|need|wanna)?\s*(to\s+)?((talk|speak|chat)\s+(to|with)\s+)?(a\s+|an\s+)?(real\s+)?(person|human|someone|somebody|agent|rep|representative)\b|\brather not (talk|speak|chat) (to|with)\b|\b(chat|this|the bot|texting)('?s| is) fine\b|\b(don'?t|do not|no need to|never)\s+(transfer|connect|pass|hand|put)\s+me\b`);
const ARE_YOU_HUMAN = t(String.raw`\b(is this|am i talking to|am i chatting with) (a |an )?(bot|robot|ai|machine|real person|human|person)\b|\b(are|r) (you|u) (a |an )?(real |actual |live )?(person|human|bot|robot|ai|machine|computer)\b|\bam i (talking|speaking|chatting) (to|with) (a |an )?(real |actual )?(person|human|bot|ai)\b`);
const INJECTION = t(String.raw`\b(ignore (all |any )?(previous|prior|above) (instructions|rules)|disregard (your|the) (instructions|rules)|system prompt|you are now|developer mode|jailbreak|pretend (to be|you are)|act as (a |an )?(different|unrestricted)|reveal your (prompt|instructions)|\bDAN (mode|prompt)\b|do anything now)`);

// weak=false skips the ambiguous rules, for a message the safety classifier has already cleared.
export function route(text: string, weak = true): Route {
  // A bare name ("Kat Smoke") or ZIP answers the assistant's question: no safety rule runs on it.
  if (!isAnswerTurn(text)) {
    const st = forSafety(text);
    for (const [re, r] of SAFETY) if (re.test(st)) return r;
    if (weak) for (const [re, r] of WEAK) if (re.test(st)) return r;
  }
  for (const [re, reason, intent] of HANDOFF) {
    if (!re.test(text)) continue;
    // A negation only cancels the ask for a person in its own clause: "I don't want a bot, I want a person" still asks.
    if (reason === "human_requested" && !text.split(/[,.;!?]|\b(?:but|and|though)\b/i).some((cl) => re.test(cl) && !NO_HUMAN.test(cl))) continue; // "I don't want to talk to a person, just book"
    return { kind: "handoff", reason, intent };
  }
  // A ZIP the service-area documents disagree on goes to a person whatever the caller asks, as check_availability would.
  for (const m of text.matchAll(/\b\d{5}\b/g)) if (zipLookup(m[0]).kind === "unclear") return { kind: "handoff", reason: "service_area_unclear", intent: "service_area" };
  if (INJECTION.test(text)) return { kind: "deflect", script: "injection", intent: "adversarial" };
  if (ARE_YOU_HUMAN.test(text) && text.length < 160) return { kind: "deflect", script: "ai_disclosure", intent: "ai_disclosure" };
  return { kind: "model" };
}

// Fixed scripts. The UI renders these from their id; the model never writes them.
export const SCRIPTS = {
  gas_co_fire:
    "This could be dangerous. If you smell gas, see sparks or smoke, or a carbon monoxide alarm is sounding, leave the house now and call 911 from outside. If it's gas, also call your gas utility's emergency line. Don't flip switches or run the system. I'm passing this to our team right away. I won't book a regular visit for this.",
  self_harm:
    "I'm really sorry you're going through this. You can call or text 988 to reach the Suicide and Crisis Lifeline any time, day or night. If you're in immediate danger, call 911. I'm also letting a person on our team know.",
  medical:
    "That sounds like a medical emergency. Call 911 now and stay with them. If you can do it safely, move them somewhere cooler, or warmer if they're cold. I'm passing this to our team right away, and a person will follow up about the repair.",
  electrical:
    "Water near an electrical panel or outlets, or a unit that shocks you, can be dangerous. Stay out of the water and away from the panel and the unit, and don't touch switches. If anyone is hurt, or you see sparks or smoke, call 911. I'm passing this to our team right away. I won't book a regular visit for this.",
  threat:
    "I can't continue with this. Threats of violence toward anyone, including our technicians, go to our team, and nothing more will be booked in this chat. If someone is in danger right now, call 911.",
  domestic_violence:
    "I'm sorry you're dealing with this. If you're in danger right now, call 911. The National Domestic Violence Hotline is free and confidential any time: call 1-800-799-7233 or text START to 88788. I'm letting a person on our team know so they can follow up carefully about your repair.",
  in_danger:
    "If you're in danger right now, call 911. Get somewhere safe and lock the door if you can. I'm letting a person on our team know, and nothing will be booked until they've followed up with you.",
  urgent:
    "This sounds urgent. If anyone is in danger, call 911 now. I'm passing this to our team right away, and I won't book a regular visit until a person has followed up.",
  self_harm_followup:
    "A person on our team has your message. Please call or text 988 any time to talk with someone at the Suicide and Crisis Lifeline, and call 911 if you're in immediate danger.",
  ai_disclosure:
    "I'm an AI, Meridian's automated assistant, not a person. I can answer questions about our services, prices, memberships and warranties, and book a visit. If you'd rather talk to a person, just say so.",
  injection:
    "I can only help with Meridian Home Comfort services: questions about our services, prices, memberships and warranties, and booking a visit. What can I help you with?",
} as const;

export const HANDOFF_COPY: Record<HandoffReason, string> = {
  safety: "I've flagged this as urgent for our team.",
  billing_account: "Payments, disputes, refunds and account changes are handled by a person, so I'm passing you to our team.",
  cancel_reschedule: "I'm passing this appointment change to our team.",
  complaint: "I'm sorry about this. I'm passing it to a person on our team who can look into it properly.",
  human_requested: "Sure, I'm connecting you with a person on our team.",
  low_confidence: "I don't want to guess on this one, so I'm passing it to a person on our team.",
  service_area_unclear: "I can't confirm we cover that address, so I'm passing this to our team to check.",
  booking_failed: "I couldn't complete the booking, so I'm passing this to our team to finish it.",
  out_of_scope: "That's something our team needs to handle, so I'm passing it to them.",
  adversarial: "I'm passing this conversation to our team.",
};
