import { describe, expect, it } from "vitest";
import { isLogistics } from "../lib/agent";

describe("isLogistics (turns that skip the KB search)", () => {
  it("matches bare booking answers", () => {
    for (const t of ["78745", "My ZIP is 78745.", "Jordan Lee", "It's Sam", "I'll take Monday, October 19, 1 pm to 5 pm (slot_id 63)."]) expect(isLogistics(t)).toBe(true);
  });
  it("leaves real questions to retrieval", () => {
    for (const t of ["What's your diagnostic fee?", "Do you service 78734?", "my furnace won't turn on", "How much is a tune-up for 78745 Austin?"]) expect(isLogistics(t)).toBe(false);
  });
});
