export type LayerId = "levels" | "noise" | "print" | "paper";
export type PrintMode = "dither" | "halftone";

export type EffectLayer = {
  id: LayerId;
  enabled: boolean;
};

export type Settings = {
  seed: number;
  targetFps: number;
  chaos: number;
  brightness: number;
  contrast: number;
  gamma: number;
  noise: number;
  noiseSize: number;
  printMode: PrintMode;
  levels: number;
  threshold: number;
  halftoneScale: number;
  dotGain: number;
  paper: number;
  banding: number;
};

export type Preset = {
  name: string;
  description: string;
  settings: Partial<Settings>;
  layers?: EffectLayer[];
};

export type MediaKind = "video" | "image";

export type MediaInfo = {
  file: File;
  kind: MediaKind;
  width: number;
  height: number;
  duration: number;
};

export const defaultLayers: EffectLayer[] = [
  { id: "levels", enabled: true },
  { id: "noise", enabled: true },
  { id: "print", enabled: true },
  { id: "paper", enabled: true },
];

export const defaultSettings: Settings = {
  seed: 8471,
  targetFps: 12,
  chaos: 0.35,
  brightness: 0,
  contrast: 1.2,
  gamma: 1,
  noise: 0.08,
  noiseSize: 2,
  printMode: "dither",
  levels: 2,
  threshold: 0.5,
  halftoneScale: 8,
  dotGain: 0.1,
  paper: 0.12,
  banding: 0.08,
};
