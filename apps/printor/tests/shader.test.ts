import { describe, expect, it } from "vitest";
import { fragmentShader } from "../src/engine/shaders";

describe("WebGL effect shader", () => {
  it("contains the shared deterministic hash constants", () => {
    expect(fragmentShader).toContain("0x21f0aaadu");
    expect(fragmentShader).toContain("0x735a2d97u");
  });

  it("supports each reorderable logical effect", () => {
    expect(fragmentShader).toContain("apply_levels");
    expect(fragmentShader).toContain("apply_noise");
    expect(fragmentShader).toContain("apply_print");
    expect(fragmentShader).toContain("apply_paper");
    expect(fragmentShader).toContain("u_order[index]");
  });
});
