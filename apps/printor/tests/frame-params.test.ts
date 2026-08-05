import { describe, expect, it } from "vitest";
import { pickTexture, resolveFrame, stageActive, texturesForRange } from "../src/engine/frameParams";
import { defaultSettings, stageOrder, type Settings } from "../src/types";

function withTextures(): Settings {
  const settings = structuredClone(defaultSettings);
  settings.paper.textures = ["a", "b", "c"];
  settings.displace.textures = ["d", "e"];
  settings.overlay.textures = ["f"];
  settings.cutout.textures = ["g", "h"];
  return settings;
}

describe("per-frame parameter resolution", () => {
  it("is deterministic for a seed and frame", () => {
    const settings = withTextures();
    expect(resolveFrame(settings, 17)).toEqual(resolveFrame(settings, 17));
  });

  it("produces different values on consecutive frames", () => {
    const settings = withTextures();
    const a = resolveFrame(settings, 4);
    const b = resolveFrame(settings, 5);
    expect(a.torn.balance).not.toBe(b.torn.balance);
    expect(a.motion.angle).not.toBe(b.motion.angle);
  });

  it("changes completely when the seed changes", () => {
    const first = withTextures();
    const second = { ...withTextures(), seed: first.seed + 1 };
    expect(resolveFrame(first, 3).torn.balance).not.toBe(resolveFrame(second, 3).torn.balance);
  });

  it("keeps every drawn value inside its configured range", () => {
    const settings = withTextures();
    for (let frame = 0; frame < 250; frame += 1) {
      const params = resolveFrame(settings, frame);
      expect(params.torn.balance).toBeGreaterThanOrEqual(settings.torn.balance.min);
      expect(params.torn.balance).toBeLessThanOrEqual(settings.torn.balance.max);
      expect(params.motion.strength).toBeGreaterThanOrEqual(settings.motion.strength.min);
      expect(params.motion.strength).toBeLessThanOrEqual(settings.motion.strength.max);
      expect(params.grain.gain).toBeGreaterThanOrEqual(settings.grain.gain.min);
      expect(params.grain.gain).toBeLessThanOrEqual(settings.grain.gain.max);
    }
  });

  it("collapses a zero-width range to its single value", () => {
    const settings = withTextures();
    settings.torn.balance = { min: 0.5, max: 0.5 };
    expect(resolveFrame(settings, 9).torn.balance).toBe(0.5);
  });

  it("tolerates an inverted range", () => {
    const settings = withTextures();
    settings.grain.grain = { min: 0.8, max: 0.2 };
    for (let frame = 0; frame < 40; frame += 1) {
      const value = resolveFrame(settings, frame).grain.grain;
      expect(value).toBeGreaterThanOrEqual(0.2);
      expect(value).toBeLessThanOrEqual(0.8);
    }
  });
});

describe("frame chance", () => {
  it("always runs a stage at 100 percent and never at zero", () => {
    const settings = withTextures();
    settings.stages.overlay.frameChance = 1;
    settings.stages.halftone.frameChance = 0;
    settings.stages.halftone.enabled = true;
    for (let frame = 0; frame < 60; frame += 1) {
      expect(stageActive(settings, "overlay", frame)).toBe(true);
      expect(stageActive(settings, "halftone", frame)).toBe(false);
    }
  });

  it("hits roughly the requested share of frames", () => {
    const settings = withTextures();
    settings.stages.overlay.enabled = true;
    settings.stages.overlay.frameChance = 0.4;
    let hits = 0;
    const frames = 4000;
    for (let frame = 0; frame < frames; frame += 1) {
      if (stageActive(settings, "overlay", frame)) hits += 1;
    }
    expect(hits / frames).toBeGreaterThan(0.36);
    expect(hits / frames).toBeLessThan(0.44);
  });

  it("keeps a disabled stage off regardless of chance", () => {
    const settings = withTextures();
    settings.stages.cutout.enabled = false;
    settings.stages.cutout.frameChance = 1;
    expect(stageActive(settings, "cutout", 0)).toBe(false);
  });

  it("draws each stage's chance independently", () => {
    const settings = withTextures();
    for (const id of stageOrder) {
      settings.stages[id].enabled = true;
      settings.stages[id].frameChance = 0.5;
    }
    const combinations = new Set<string>();
    for (let frame = 0; frame < 200; frame += 1) {
      combinations.add(stageOrder.map((id) => (stageActive(settings, id, frame) ? "1" : "0")).join(""));
    }
    expect(combinations.size).toBeGreaterThan(20);
  });
});

describe("texture selection", () => {
  it("returns null when nothing is selected", () => {
    expect(pickTexture([], 1, 0, "paper")).toBeNull();
  });

  it("only ever returns a selected id", () => {
    const pool = ["a", "b", "c"];
    for (let frame = 0; frame < 200; frame += 1) {
      expect(pool).toContain(pickTexture(pool, 8471, frame, "paper"));
    }
  });

  it("spreads across the pool rather than sticking to one entry", () => {
    const pool = ["a", "b", "c", "d"];
    const seen = new Set<string | null>();
    for (let frame = 0; frame < 200; frame += 1) seen.add(pickTexture(pool, 8471, frame, "overlay"));
    expect(seen.size).toBe(pool.length);
  });

  it("reports every texture a frame range can ask for", () => {
    const settings = withTextures();
    const needed = texturesForRange(settings, 120);
    expect(needed.length).toBeGreaterThan(0);
    for (const id of needed) {
      expect(["a", "b", "c", "d", "e", "f", "g", "h"]).toContain(id);
    }
  });
});

describe("still image sequences", () => {
  it("a still yields as many distinct frames as requested", () => {
    const settings = withTextures();
    settings.stillFrames = 30;
    // Nothing in the source changes, so every difference has to come from the
    // per-frame draws. If they collapsed, a still would print 30 identical frames.
    const prints = new Set<string>();
    for (let frame = 0; frame < settings.stillFrames; frame += 1) {
      const params = resolveFrame(settings, frame);
      prints.add(JSON.stringify([
        params.torn.balance,
        params.grain.grain,
        params.paper.textureId,
        params.paper.rotation,
      ]));
    }
    expect(prints.size).toBe(settings.stillFrames);
  });
});
