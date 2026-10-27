import { describe, expect, it } from "vitest";
import { classify, errorName, isChunkLoadError, pageOf } from "../lib/clienterror";

describe("browser error reports (2026-10-27)", () => {
  it("maps paths to a fixed set of pages", () => {
    expect(pageOf("/")).toBe("/");
    expect(pageOf("/chat")).toBe("/chat");
    expect(pageOf("/staff/handoffs")).toBe("/staff");
    expect(pageOf("/evaluation")).toBe("/evaluation");
    expect(pageOf("/some/user-typed-path?x=1")).toBe("other");
  });
  it("keeps only a plausible class name, never the message", () => {
    expect(errorName(new TypeError("call 512-555-0161 failed"))).toBe("TypeError");
    const odd = new Error("x"); odd.name = "has spaces and 512-555-0161";
    expect(errorName(odd)).toBeUndefined();
    expect(errorName("a string")).toBeUndefined();
  });
  it("recognises failed script downloads", () => {
    const c = new Error("Loading chunk 123 failed."); c.name = "ChunkLoadError";
    expect(isChunkLoadError(c)).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /_next/static/x.js"))).toBe(true);
    expect(classify(new TypeError("x is undefined"), "render")).toBe("render");
    expect(classify(c, "render")).toBe("chunk_load");
  });
});
