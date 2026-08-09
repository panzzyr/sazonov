import { describe, expect, it } from "vitest";
import { hash32, randomFloat } from "../src/engine/hash";

describe("deterministic frame randomization", () => {
  it("returns the same value for the same coordinates", () => {
    expect(hash32(8471, 12, 3, 8)).toBe(hash32(8471, 12, 3, 8));
  });

  it("changes when a frame or channel changes", () => {
    expect(hash32(8471, 12, 3, 8)).not.toBe(hash32(8471, 13, 3, 8));
    expect(hash32(8471, 12, 3, 8)).not.toBe(hash32(8471, 12, 3, 9));
  });

  it("maps output to the half-open unit interval", () => {
    for (let frame = 0; frame < 100; frame += 1) {
      const value = randomFloat(8471, frame, 2, 0);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
