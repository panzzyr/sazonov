import { describe, expect, it } from "vitest";
import { exportSvg, traceAlpha } from "../src/export/svg";
import type { GlyphLibrary } from "../src/engine/glyphLibrary";
import { defaultSettings, type Settings } from "../src/types";

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

/**
 * A halftone reads the tone field and nothing else — no marks, no ramp — so the
 * library the glyph path needs is never touched here.
 */
const noLibrary = { metrics: [], get: () => undefined } as unknown as GlyphLibrary;

const grey = (value: number, gridW = 8, gridH = 8) => ({
  gridW,
  gridH,
  tone: new Float32Array(gridW * gridH),
  color: new Uint8ClampedArray(gridW * gridH * 3).fill(value),
});

async function halftoneSvg(overrides: Partial<Settings["halftone"]> = {}, invert = false) {
  const settings: Settings = {
    ...defaultSettings,
    mode: "halftone",
    invert,
    halftone: { ...defaultSettings.halftone, lines: 12, ...overrides },
  };
  const blob = exportSvg({
    settings,
    field: grey(64),
    library: noLibrary,
    frame: 0,
    size: { width: 240, height: 180 },
  }, "test");
  return blob.text();
}

describe("the halftone SVG", () => {
  it("is the frame it was given, not one re-derived from the field", async () => {
    const svg = await halftoneSvg();
    expect(svg).toContain('width="240" height="180" viewBox="0 0 240 180"');
  });

  it("writes one plate, on white paper, with no blend mode to misread", async () => {
    const svg = await halftoneSvg();
    expect(svg.match(/<path id="plate-/g)).toHaveLength(1);
    expect(svg).toContain('id="plate-black" fill="#000000"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain("mix-blend-mode");
  });

  it("multiplies the plates of a separation, the way the inks do", async () => {
    const svg = await halftoneSvg({ separation: "cmyk" });
    expect(svg.match(/<path id="plate-/g)).toHaveLength(4);
    for (const name of ["cyan", "magenta", "yellow", "black"]) {
      expect(svg).toContain(`id="plate-${name}"`);
    }
    expect(svg.match(/mix-blend-mode:multiply/g)).toHaveLength(4);
  });

  it("inverts as negated inks screened on black, which is the same composite", async () => {
    const svg = await halftoneSvg({ separation: "cmyk" }, true);
    expect(svg).toContain('fill="#000000"');
    // Cyan's negative is red, and screening it back is 1 − ab either way.
    expect(svg).toContain('id="plate-cyan" fill="#ff0000"');
    expect(svg.match(/mix-blend-mode:screen/g)).toHaveLength(4);
  });

  it("solves dots as real curves rather than tracing a raster", async () => {
    const data = async (shape: Settings["halftone"]["shape"]) =>
      /\sd="([^"]+)"/.exec(await halftoneSvg({ shape }))?.[1] ?? "";
    // A round dot is two arcs, and a square one has no curve in it at all.
    expect(await data("round")).toMatch(/^M[-\d. ]+a[\d. ]+1 1/);
    expect(await data("square")).toMatch(/^M[-\d. ]+L/);
    expect(await data("square")).not.toMatch(/[aAcCqQsStT]/);
  });

  it("leaves out a plate that has no ink to print", async () => {
    const settings: Settings = {
      ...defaultSettings,
      mode: "halftone",
      halftone: { ...defaultSettings.halftone, lines: 12, separation: "cmyk" },
    };
    const svg = await exportSvg({
      settings,
      field: grey(255),
      library: noLibrary,
      frame: 0,
      size: { width: 240, height: 180 },
    }, "test").text();
    expect(svg).not.toContain("<path");
  });
});
