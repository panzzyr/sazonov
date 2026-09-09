import { describe, expect, it } from "vitest";
import { traceAlpha } from "../src/export/svg";

describe("SVG mask tracing", () => {
  it("merges identical pixel runs vertically", () => {
    const alpha = new Uint8ClampedArray([
      0, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 255, 0,
    ]);
    expect(traceAlpha(alpha, 4, 3)).toBe("M1 0h2v2h-2zM2 2h1v1h-1z");
  });

  it("drops the antialiased fringe below the trace threshold", () => {
    const alpha = new Uint8ClampedArray([31, 32, 255]);
    expect(traceAlpha(alpha, 3, 1)).toBe("M1 0h2v1h-2z");
  });
});
