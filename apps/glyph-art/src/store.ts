import { create } from "zustand";
import { defaultBandGlyphs, markSpecs } from "./engine/marks";
import { fitPeak, rebalance, type DensityLookup } from "./engine/ramp";
import { applyPreset, type Preset } from "./presets";
import {
  defaultBandCount,
  defaultSettings,
  emptyBand,
  maxBands,
  minBands,
  type Band,
  type GlyphSpec,
  type Settings,
} from "./types";

export type Snapshot = { settings: Settings };

/**
 * Slider drags fire an update per pointer move. Collapsing edits to the same
 * control inside this window keeps undo stepping through intentions rather
 * than through individual pixels of mouse travel.
 */
const COALESCE_MS = 500;
const HISTORY_LIMIT = 50;

function clone(settings: Settings): Settings {
  return structuredClone(settings);
}

export function initialSettings(): Settings {
  return {
    ...clone(defaultSettings),
    glyphs: markSpecs(),
    bands: defaultBandGlyphs(defaultBandCount).map((glyphs) => ({ glyphs, size: null })),
  };
}

/**
 * Stretches a band list to a new length by nearest index.
 *
 * Rebuilding from the shipped set would be simpler and would throw away the
 * user's own marks the first time they touched the band count. Resampling
 * keeps the shape of the ramp they built and only re-solves the sizes.
 */
export function resampleBands(bands: Band[], count: number): Band[] {
  if (count === bands.length) return bands.map((band) => ({ ...band, glyphs: [...band.glyphs] }));
  if (bands.length === 0) return Array.from({ length: count }, emptyBand);
  const next: Band[] = [];
  for (let index = 0; index < count; index += 1) {
    const source = count === 1
      ? bands[bands.length - 1]
      : bands[Math.round((index * (bands.length - 1)) / (count - 1))];
    next.push({ glyphs: [...source.glyphs], size: null });
  }
  return next;
}

type GlobalKey =
  | "mode"
  | "seed"
  | "grid"
  | "weight"
  | "peak"
  | "maxSize"
  | "halftone"
  | "hand"
  | "colorMode"
  | "invert"
  | "rampInvert"
  | "targetFps"
  | "stillFrames"
  | "hold"
  | "levels";

type GlyphArtStore = {
  settings: Settings;
  selectedBand: number;
  past: Snapshot[];
  future: Snapshot[];
  lastEditKey: string;
  lastEditAt: number;

  selectBand: (index: number) => void;
  setGlobal: <Key extends GlobalKey>(key: Key, value: Settings[Key], editKey?: string) => void;
  setBandCount: (count: number) => void;
  setBandGlyphs: (index: number, glyphs: string[]) => void;
  setBandSize: (index: number, size: number | null) => void;
  addGlyphs: (specs: GlyphSpec[], bandIndex?: number) => void;
  removeGlyph: (id: string) => void;
  rebalanceBands: () => void;
  usePreset: (preset: Preset) => void;
  fitRamp: (lookup: DensityLookup) => void;
  replaceSettings: (settings: Settings) => void;
  reroll: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
};

export const useGlyphArtStore = create<GlyphArtStore>((set) => {
  /**
   * Applies `mutate` and records history. `editKey` identifies the control
   * being edited so consecutive edits to the same one coalesce.
   */
  function edit(mutate: (settings: Settings) => void, editKey = "") {
    set((state) => {
      const settings = clone(state.settings);
      mutate(settings);
      const now = Date.now();
      const coalesce = editKey !== ""
        && editKey === state.lastEditKey
        && now - state.lastEditAt < COALESCE_MS
        && state.past.length > 0;
      return {
        settings,
        past: coalesce
          ? state.past
          : [...state.past, { settings: state.settings }].slice(-HISTORY_LIMIT),
        future: [],
        lastEditKey: editKey,
        lastEditAt: now,
      };
    });
  }

  return {
    settings: initialSettings(),
    selectedBand: 1,
    past: [],
    future: [],
    lastEditKey: "",
    lastEditAt: 0,

    selectBand: (selectedBand) => set({ selectedBand }),

    setGlobal: (key, value, editKey) => edit((settings) => {
      settings[key] = value;
    }, editKey ?? `global.${key}`),

    setBandCount: (count) => edit((settings) => {
      const clamped = Math.max(minBands, Math.min(maxBands, Math.round(count)));
      settings.bands = resampleBands(settings.bands, clamped);
    }, "bands.count"),

    setBandGlyphs: (index, glyphs) => edit((settings) => {
      const band = settings.bands[index];
      if (band) band.glyphs = glyphs;
    }),

    setBandSize: (index, size) => edit((settings) => {
      const band = settings.bands[index];
      if (band) band.size = size;
    }, `bands.${index}.size`),

    addGlyphs: (specs, bandIndex) => edit((settings) => {
      for (const spec of specs) {
        if (!settings.glyphs.some((existing) => existing.id === spec.id)) settings.glyphs.push(spec);
      }
      if (bandIndex === undefined) {
        // A set loaded with no target spreads across the ramp in file order —
        // the fast path from a folder of drawings to a working ramp.
        //
        // Spread *proportionally*, not one file per band from the top: three
        // files over six bands should cover all six, each mark printing at two
        // sizes, rather than leaving the shipped marks on the dark half and
        // making a mongrel of the ramp. Band 0 stays paper.
        const marked = settings.bands.length - 1;
        if (marked <= 0 || specs.length === 0) return;
        for (let band = 1; band <= marked; band += 1) {
          const pick = Math.min(specs.length - 1, Math.floor(((band - 1) * specs.length) / marked));
          settings.bands[band].glyphs = [specs[pick].id];
          settings.bands[band].size = null;
        }
        return;
      }
      const band = settings.bands[bandIndex];
      if (band) band.glyphs = [...band.glyphs, ...specs.map((spec) => spec.id)];
    }),

    removeGlyph: (id) => edit((settings) => {
      settings.glyphs = settings.glyphs.filter((spec) => spec.id !== id);
      for (const band of settings.bands) {
        band.glyphs = band.glyphs.filter((glyph) => glyph !== id);
      }
    }),

    rebalanceBands: () => edit((settings) => {
      settings.bands = rebalance(settings.bands);
    }),

    usePreset: (preset) => edit((settings) => {
      applyPreset(settings, preset);
    }),

    fitRamp: (lookup) => edit((settings) => {
      settings.peak = fitPeak(settings, lookup);
      settings.bands = rebalance(settings.bands);
    }),

    replaceSettings: (next) => edit((settings) => {
      Object.assign(settings, clone(next));
    }),

    reroll: () => edit((settings) => {
      settings.seed = (Math.imul(settings.seed, 1664525) + 1013904223) >>> 0;
    }),

    undo: () => set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        settings: previous.settings,
        past: state.past.slice(0, -1),
        future: [{ settings: state.settings }, ...state.future].slice(0, HISTORY_LIMIT),
        lastEditKey: "",
      };
    }),

    redo: () => set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return {
        settings: next.settings,
        past: [...state.past, { settings: state.settings }].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        lastEditKey: "",
      };
    }),

    reset: () => edit((settings) => {
      Object.assign(settings, initialSettings(), { seed: settings.seed });
    }),
  };
});
