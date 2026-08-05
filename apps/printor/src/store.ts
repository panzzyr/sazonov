import { create } from "zustand";
import { texturesByGroup } from "./generatedTextures";
import {
  defaultSettings,
  stageTextureGroup,
  textureStages,
  type Settings,
  type StageId,
  type TextureStageId,
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

/** Fills every texture stage with a sensible slice of the shipped library. */
export function withDefaultTextures(settings: Settings): Settings {
  const next = clone(settings);
  for (const stage of textureStages) {
    if (next[stage].textures.length) continue;
    const group = texturesByGroup.get(stageTextureGroup[stage]) ?? [];
    next[stage].textures = group
      // Soft paper defaults to the light stock; the dark scans are opt-in.
      .filter((texture) => (stage === "paper" ? texture.tone === "light" : true))
      .map((texture) => texture.id);
  }
  return next;
}

export function initialSettings() {
  return withDefaultTextures(defaultSettings);
}

type PrintorStore = {
  settings: Settings;
  selectedStage: StageId;
  past: Snapshot[];
  future: Snapshot[];
  lastEditKey: string;
  lastEditAt: number;

  selectStage: (id: StageId) => void;
  setGlobal: <Key extends "seed" | "targetFps" | "invert">(key: Key, value: Settings[Key]) => void;
  updateStage: <Key extends StageId>(id: Key, patch: Partial<Settings[Key]>, editKey?: string) => void;
  setStageEnabled: (id: StageId, enabled: boolean) => void;
  setFrameChance: (id: StageId, chance: number) => void;
  setTextures: (id: TextureStageId, textures: string[]) => void;
  replaceSettings: (settings: Settings) => void;
  reroll: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
};

export const usePrintorStore = create<PrintorStore>((set) => {
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
    selectedStage: "torn",
    past: [],
    future: [],
    lastEditKey: "",
    lastEditAt: 0,

    selectStage: (selectedStage) => set({ selectedStage }),

    setGlobal: (key, value) => edit((settings) => {
      settings[key] = value;
    }, `global.${key}`),

    updateStage: (id, patch, editKey) => edit((settings) => {
      Object.assign(settings[id], patch);
    }, editKey ?? `${id}.patch`),

    setStageEnabled: (id, enabled) => edit((settings) => {
      settings.stages[id].enabled = enabled;
    }),

    setFrameChance: (id, chance) => edit((settings) => {
      settings.stages[id].frameChance = Math.max(0, Math.min(1, chance));
    }, `${id}.chance`),

    setTextures: (id, textures) => edit((settings) => {
      settings[id].textures = textures;
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
