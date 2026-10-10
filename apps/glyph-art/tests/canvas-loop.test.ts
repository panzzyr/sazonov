import { afterEach, describe, expect, it, vi } from "vitest";
import { GlyphRenderer } from "../src/engine/render";
import type { GlyphLibrary, MeasuredGlyph } from "../src/engine/glyphLibrary";
import { initialSettings } from "../src/store";

afterEach(() => vi.unstubAllGlobals());

describe("canvas loop propagation", () => {
  it("passes the still period all the way to the stamp pass, not just the SVG placements", () => {
    const stamped: string[] = [];
    const canvas = () => ({
      width: 0, height: 0,
      getContext: () => ({
        setTransform() {}, clearRect() {}, fillRect() {},
        drawImage(source: { glyphId?: string }) {
          if (source.glyphId) stamped.push(source.glyphId);
        },
      }),
    }) as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: canvas });
    const settings = initialSettings();
    settings.targetFps = 30; settings.stillFrames = 120;
    settings.symbolMotion = { mode: "scatter", loop: true, amount: 10, interval: 250 };
    settings.bands = [{ glyphs: settings.glyphs.map(glyph => glyph.id), size: 0.9 }];
    const measured = new Map(settings.glyphs.map(spec => [spec.id, {
      spec, density: 0.5, aspect: 1,
      bitmap: { glyphId: spec.id, width: 30, height: 30 } as unknown as HTMLCanvasElement,
      box: { x: 0, y: 0, width: 30, height: 30 },
    } satisfies MeasuredGlyph]));
    const library = { get: (id: string) => measured.get(id), metrics: (id: string) => measured.get(id) } as GlyphLibrary;
    const field = { gridW: 30, gridH: 40, tone: new Float32Array(1200).fill(0.45), color: new Uint8ClampedArray(3600) };
    const renderer = new GlyphRenderer(canvas());
    const render = (frame: number, loop = true) => {
      stamped.length = 0;
      renderer.render({ settings: { ...settings, symbolMotion: { ...settings.symbolMotion, loop } },
        field, library, frame, loopFrames: 120, ink: "flat", size: { width: 300, height: 400 } });
      return [...stamped];
    };
    const first = render(0);
    expect(first).toHaveLength(1200);
    expect(render(60)).not.toEqual(first);
    expect(render(120)).toEqual(first);
    expect(render(240)).toEqual(first);
    expect(render(120, false)).not.toEqual(first);
  });
});
