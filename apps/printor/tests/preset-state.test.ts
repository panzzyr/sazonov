import { describe, expect, it } from "vitest";
import { decodeSnapshot, defaultSnapshot, encodeSnapshot, parseSnapshot } from "../src/presetState";

describe("portable preset state", () => {
  it("round-trips through a URL-safe string", () => {
    const source = defaultSnapshot();
    source.settings.seed = 123456;
    source.settings.printMode = "halftone";
    expect(decodeSnapshot(encodeSnapshot(source))).toEqual(source);
  });

  it("rejects a malformed layer stack", () => {
    expect(() => parseSnapshot({ settings: {}, layers: [] })).toThrow(/layer stack/i);
  });
});
