import { create } from "zustand";
import {
  defaultLayers,
  defaultSettings,
  type EffectLayer,
  type LayerId,
  type Preset,
  type Settings,
} from "./types";

type PrintorStore = {
  settings: Settings;
  layers: EffectLayer[];
  selectedLayer: LayerId;
  past: Snapshot[];
  future: Snapshot[];
  setSetting: <Key extends keyof Settings>(key: Key, value: Settings[Key]) => void;
  selectLayer: (id: LayerId) => void;
  toggleLayer: (id: LayerId) => void;
  moveLayer: (from: number, to: number) => void;
  applyPreset: (preset: Preset) => void;
  replaceState: (snapshot: Snapshot) => void;
  reroll: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
};

export type Snapshot = {
  settings: Settings;
  layers: EffectLayer[];
};

function snapshot(state: Pick<PrintorStore, "settings" | "layers">): Snapshot {
  return {
    settings: { ...state.settings },
    layers: state.layers.map((layer) => ({ ...layer })),
  };
}

function history(state: PrintorStore) {
  return {
    past: [...state.past.slice(-49), snapshot(state)],
    future: [],
  };
}

export const usePrintorStore = create<PrintorStore>((set) => ({
  settings: defaultSettings,
  layers: defaultLayers,
  selectedLayer: "print",
  past: [],
  future: [],
  setSetting: (key, value) =>
    set((state) => ({
      ...history(state),
      settings: { ...state.settings, [key]: value },
    })),
  selectLayer: (selectedLayer) => set({ selectedLayer }),
  toggleLayer: (id) =>
    set((state) => ({
      ...history(state),
      layers: state.layers.map((layer) =>
        layer.id === id ? { ...layer, enabled: !layer.enabled } : layer),
    })),
  moveLayer: (from, to) =>
    set((state) => {
      const layers = [...state.layers];
      const [moved] = layers.splice(from, 1);
      layers.splice(to, 0, moved);
      return { ...history(state), layers };
    }),
  applyPreset: (preset) =>
    set((state) => ({
      ...history(state),
      settings: { ...defaultSettings, ...preset.settings },
      layers: preset.layers ? preset.layers.map((layer) => ({ ...layer })) : state.layers,
    })),
  replaceState: (next) =>
    set((state) => ({
      ...history(state),
      settings: { ...defaultSettings, ...next.settings },
      layers: next.layers.map((layer) => ({ ...layer })),
    })),
  reroll: () =>
    set((state) => ({
      ...history(state),
      settings: {
        ...state.settings,
        seed: (Math.imul(state.settings.seed, 1664525) + 1013904223) >>> 0,
      },
    })),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        settings: previous.settings,
        layers: previous.layers,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, 50),
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      return {
        settings: next.settings,
        layers: next.layers,
        past: [...state.past, snapshot(state)].slice(-50),
        future: state.future.slice(1),
      };
    }),
  reset: () =>
    set((state) => ({
      ...history(state),
      settings: defaultSettings,
      layers: defaultLayers,
    })),
}));
