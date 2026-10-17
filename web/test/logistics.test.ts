import { describe, expect, it } from "vitest";
import { isLogistics } from "../lib/agent";

describe("isLogistics (turns that skip the KB search)", () => {
  it("matches bare booking answers", () => {
    for (const t of ["78745", "My ZIP is 78745.", "Jordan Lee", "It's Sam", "I'll take Monday, October 19, 1 pm to 5 pm (slot_id 63).", "512-555-0142, 78664", "512-555-0187, ZIP 78664", "My phone number is 512-555-0142 and my ZIP is 78664."]) expect(isLogistics(t)).toBe(true);
  });
  it("leaves real questions to retrieval", () => {
    for (const t of ["What's your diagnostic fee?", "Do you service 78734?", "my furnace won't turn on", "How much is a tune-up for 78745 Austin?"]) expect(isLogistics(t)).toBe(false);
  });
});

import { isSelfNote } from "../lib/agent";
describe("isSelfNote (model notes withdrawn from the screen)", () => {
  it("catches notes to self", () => {
    for (const t of ["Need ZIP first. Could offer quick checks briefly.", "Passages are empty, so search the knowledge base.", "Furnace not turning on is hvac_repair."]) expect(isSelfNote(t)).toBe(true);
  });
  it("keeps replies to the caller", () => {
    for (const t of ["I'm sorry your AC stopped working.", "Good news, we serve 78745.", "Yes, the diagnostic fee is $89 and you can book online."]) expect(isSelfNote(t)).toBe(false);
  });
});
