import { describe, expect, it } from "vitest";
import { fragmentShader } from "../src/engine/shaders";
import { stageOrder } from "../src/types";

describe("print pipeline shader", () => {
  it("shares the deterministic hash constants with the CPU implementation", () => {
    expect(fragmentShader).toContain("0x21f0aaadu");
    expect(fragmentShader).toContain("0x735a2d97u");
  });

  it("carries an activity flag for every stage", () => {
    expect(fragmentShader).toContain(`uniform int u_active[${stageOrder.length}]`);
    for (let index = 0; index < stageOrder.length; index += 1) {
      expect(fragmentShader).toContain(`u_active[${index}]`);
    }
  });

  it("implements the stages the look depends on", () => {
    expect(fragmentShader).toContain("torn_edges");
    expect(fragmentShader).toContain("halftone");
    expect(fragmentShader).toContain("displacement");
    expect(fragmentShader).toContain("motion_sample");
  });

  it("seeds its spatial noise so a reroll changes the tear", () => {
    expect(fragmentShader).toMatch(/hash32\(u_seed, u_frame/);
  });

  it("writes grayscale only", () => {
    // Every output path is either one value replicated across RGB or a pure
    // black/white ink, so no colour fringe can survive the pipeline.
    expect(fragmentShader).toContain("out_color = vec4(vec3(value), mask)");
    expect(fragmentShader).toContain("out_color = vec4(1.0, 1.0, 1.0, value * mask)");
    expect(fragmentShader).toContain("out_color = vec4(0.0, 0.0, 0.0, (1.0 - value) * mask)");
  });

  it("does not fall back to an unseeded noise idiom", () => {
    expect(fragmentShader).not.toContain("fract(sin(");
  });
});
