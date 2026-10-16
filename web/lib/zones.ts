// ZIP -> service zone, from the KB service area page (2026-04-01) and the SCHEMA zone map.
// Known conflicts (audit): Lakeway ZIPs are 787xx but Lakeway is "not serviced"; Dripping Springs and Manor
// were added in April 2026 but have no scheduling zone. Those cases escalate instead of guessing.
export type Zone = "north" | "central" | "south";
export type ZipResult =
  | { kind: "zone"; zone: Zone; city: string }
  | { kind: "not_serviced"; city: string }
  | { kind: "unclear"; city: string; why: string }
  | { kind: "unknown" };

const NORTH: Record<string, string> = {
  "78664": "Round Rock", "78665": "Round Rock", "78681": "Round Rock",
  "78613": "Cedar Park", "78641": "Leander", "78645": "Leander",
  "78660": "Pflugerville", "78634": "Hutto",
  "78626": "Georgetown", "78628": "Georgetown", "78633": "Georgetown",
};
const SOUTH: Record<string, string> = { "78640": "Kyle", "78610": "Buda" };
const NO_ZONE: Record<string, string> = { "78620": "Dripping Springs", "78653": "Manor" };
const LAKEWAY = new Set(["78734", "78738"]);
const NOT_SERVICED: Record<string, string> = {
  "78666": "San Marcos", "78667": "San Marcos", "78602": "Bastrop", "78621": "Elgin",
};

export function zipLookup(zip: string): ZipResult {
  const z = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(z)) return { kind: "unknown" };
  if (NORTH[z]) return { kind: "zone", zone: "north", city: NORTH[z] };
  if (SOUTH[z]) return { kind: "zone", zone: "south", city: SOUTH[z] };
  if (NO_ZONE[z]) return { kind: "unclear", city: NO_ZONE[z], why: "newly added area with no scheduling zone yet" };
  if (LAKEWAY.has(z)) return { kind: "unclear", city: "Lakeway", why: "service area documents conflict for Lakeway" };
  if (NOT_SERVICED[z]) return { kind: "not_serviced", city: NOT_SERVICED[z] };
  if (z.startsWith("787")) return { kind: "zone", zone: "central", city: "Austin" };
  // A valid ZIP that the service area page does not list is outside the area.
  return { kind: "not_serviced", city: "" };
}
