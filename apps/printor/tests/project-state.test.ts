import { describe, expect, it } from "vitest";
import { decodeSettings, encodeSettings, parseSettings } from "../src/projectState";
import { initialSettings } from "../src/store";
import { defaultSettings, maxExportFrames, maxFps, minFps } from "../src/types";

describe("project encoding", () => {
  it("round-trips a project through the share encoding", () => {
    const settings = initialSettings();
    settings.torn.balance = { min: 0.2, max: 0.9 };
    settings.targetFps = 8;
    const restored = decodeSettings(encodeSettings(settings));
    expect(restored.torn.balance).toEqual({ min: 0.2, max: 0.9 });
    expect(restored.targetFps).toBe(8);
  });

  it("produces a URL-safe payload", () => {
    expect(encodeSettings(initialSettings())).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("untrusted project input", () => {
  it("rejects a non-object", () => {
    expect(() => parseSettings("nope")).toThrow();
    expect(() => parseSettings(null)).toThrow();
  });

  it("falls back to defaults for missing fields", () => {
    const settings = parseSettings({ settings: {} });
    expect(settings.torn.balance).toEqual(defaultSettings.torn.balance);
  });

  it("clamps the frame rate into the supported band", () => {
    expect(parseSettings({ settings: { targetFps: 240 } }).targetFps).toBe(maxFps);
    expect(parseSettings({ settings: { targetFps: -5 } }).targetFps).toBe(minFps);
  });

  it("clamps out-of-band parameters instead of trusting them", () => {
    const settings = parseSettings({
      settings: { grain: { gain: { min: -100, max: 9999 } } },
    });
    expect(settings.grain.gain.min).toBe(0);
    expect(settings.grain.gain.max).toBe(8);
  });

  it("drops non-finite numbers", () => {
    const settings = parseSettings({ settings: { seed: Number.NaN } });
    expect(Number.isFinite(settings.seed)).toBe(true);
  });

  it("ignores texture ids that this build does not ship", () => {
    const settings = parseSettings({
      settings: { paper: { textures: ["../../etc/passwd", "not-a-texture"] } },
    });
    expect(settings.paper.textures).not.toContain("../../etc/passwd");
    expect(settings.paper.textures).not.toContain("not-a-texture");
  });

  it("refuses an unknown blend mode", () => {
    const settings = parseSettings({ settings: { paper: { blend: "evil" } } });
    expect(settings.paper.blend).toBe(defaultSettings.paper.blend);
  });

  it("keeps frame chance inside zero to one", () => {
    const settings = parseSettings({
      settings: { stages: { overlay: { frameChance: 42, enabled: true } } },
    });
    expect(settings.stages.overlay.frameChance).toBe(1);
  });

  it("restores a stage that a project left with no textures", () => {
    const settings = parseSettings({ settings: { paper: { textures: [] } } });
    const total = settings.paper.textures.length
      + settings.displace.textures.length
      + settings.overlay.textures.length;
    expect(total).toBeGreaterThan(0);
  });
});

describe("still frame count", () => {
  it("round-trips through the share encoding", () => {
    const settings = initialSettings();
    settings.stillFrames = 48;
    expect(decodeSettings(encodeSettings(settings)).stillFrames).toBe(48);
  });

  it("clamps to at least one frame and at most the export ceiling", () => {
    expect(parseSettings({ settings: { stillFrames: 0 } }).stillFrames).toBe(1);
    expect(parseSettings({ settings: { stillFrames: -20 } }).stillFrames).toBe(1);
    expect(parseSettings({ settings: { stillFrames: 99999 } }).stillFrames).toBe(maxExportFrames);
  });

  it("rounds a fractional count", () => {
    expect(parseSettings({ settings: { stillFrames: 12.7 } }).stillFrames).toBe(13);
  });
});
