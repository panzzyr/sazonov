/**
 * printor pipeline model.
 *
 * Every stage runs in a fixed order and every numeric parameter is a range.
 * For each output frame the range collapses to a single value drawn from
 * `hash(seed, frame, stage, channel)`, so a seed reproduces a sequence exactly
 * while consecutive frames differ — which is the whole point of the look.
 */

export type Range = { min: number; max: number };

export type StageId =
  | "motion"
  | "paper"
  | "grain"
  | "torn"
  | "wiggle"
  | "displace"
  | "halftone"
  | "cutout"
  | "overlay";

export const stageOrder: StageId[] = [
  "motion",
  "paper",
  "grain",
  "torn",
  "wiggle",
  "displace",
  "halftone",
  "cutout",
  "overlay",
];

export const stageLabels: Record<StageId, string> = {
  motion: "motion blur",
  paper: "soft paper",
  grain: "grain & gain",
  torn: "torn edges",
  wiggle: "wiggle",
  displace: "displacement",
  halftone: "halftone",
  cutout: "paper cuts",
  overlay: "overlay",
};

export const stageHints: Record<StageId, string> = {
  motion: "Directional smear applied to the source frame.",
  paper: "Soft paper stock multiplied under the print.",
  grain: "Noise and contrast that feed the torn-edge threshold.",
  torn: "The silkscreen threshold. This is what makes the print.",
  wiggle: "Whole-frame registration drift, like a misfed sheet.",
  displace: "Warps the frame with a paper texture as a height map.",
  halftone: "Procedural rotated dot screen.",
  cutout: "Torn paper shapes used as an alpha mask.",
  overlay: "Hard paper stock laid over the finished print.",
};

export type BlendMode = "multiply" | "screen" | "overlay" | "softlight";

export const blendModes: BlendMode[] = ["multiply", "screen", "overlay", "softlight"];

/** Stages that pick an image from the library each frame. */
export type TextureStageId = "paper" | "displace" | "cutout" | "overlay";

export const textureStages: TextureStageId[] = ["paper", "displace", "cutout", "overlay"];

/** Which library group each texture stage draws from. */
export const stageTextureGroup: Record<TextureStageId, string> = {
  paper: "soft-paper",
  displace: "hard-paper",
  cutout: "paper-parts",
  overlay: "hard-paper",
};

export type Stage = {
  enabled: boolean;
  /** Fraction of frames the stage applies to, 0..1. */
  frameChance: number;
};

export type PlacementSettings = {
  /** Library texture ids the stage may draw from. */
  textures: string[];
  /** Percent of the frame, 100..1000. */
  scale: Range;
  rotation: Range;
  /** Offset from centre as a fraction of the frame. */
  offset: Range;
};

export type MotionSettings = {
  strength: Range;
  angle: Range;
  samples: number;
  bothDirections: boolean;
};

export type PaperSettings = PlacementSettings & {
  opacity: Range;
  blend: BlendMode;
};

export type GrainSettings = {
  grain: Range;
  gain: Range;
  /** Noise cell size in pixels; 1 is per-pixel. */
  size: Range;
};

export type TornSettings = {
  /** Photoshop's Image Balance — where the threshold sits. */
  balance: Range;
  /** Higher smoothness means larger, calmer tears. */
  smoothness: Range;
  /** Higher contrast means a harder edge. */
  contrast: Range;
  /** Depth of the ragged boundary. */
  roughness: Range;
};

export type WiggleSettings = {
  /** Displacement magnitude in pixels; direction is drawn per frame. */
  amount: Range;
  rotation: Range;
};

export type DisplaceSettings = PlacementSettings & {
  /** Peak displacement in pixels. */
  amount: Range;
};

export type HalftoneSettings = {
  /** Screen cell size in pixels. */
  cell: Range;
  angle: Range;
  strength: Range;
};

export type CutoutSettings = PlacementSettings & {
  /** Softness of the mask edge, 0..1. */
  feather: Range;
  /** Invert the mask so the paper shape punches a hole instead. */
  invert: boolean;
};

export type OverlaySettings = PaperSettings;

export type Settings = {
  seed: number;
  /** Time posterization, 4..16 frames per second. */
  targetFps: number;
  /** Invert the finished grayscale frame. */
  invert: boolean;
  stages: Record<StageId, Stage>;
  motion: MotionSettings;
  paper: PaperSettings;
  grain: GrainSettings;
  torn: TornSettings;
  wiggle: WiggleSettings;
  displace: DisplaceSettings;
  halftone: HalftoneSettings;
  cutout: CutoutSettings;
  overlay: OverlaySettings;
};

/**
 * How a finished grayscale frame is written out.
 *  flat  — opaque grayscale
 *  white — keep the white ink, black becomes transparent
 *  black — keep the black ink, white becomes transparent
 */
export type ExportInk = "flat" | "white" | "black";

export type ExportFormat = "png" | "mp4";

export type MediaKind = "video" | "image";

export const minFps = 4;
export const maxFps = 16;

function range(min: number, max: number): Range {
  return { min, max };
}

function stage(enabled: boolean, frameChance = 1): Stage {
  return { enabled, frameChance };
}

export const defaultSettings: Settings = {
  seed: 8471,
  targetFps: 12,
  invert: false,
  stages: {
    motion: stage(true),
    paper: stage(true),
    grain: stage(true),
    torn: stage(true),
    wiggle: stage(true),
    displace: stage(true, 0.6),
    halftone: stage(false, 0.5),
    cutout: stage(false, 0.4),
    overlay: stage(true, 0.4),
  },
  motion: {
    strength: range(2, 14),
    angle: range(-180, 180),
    samples: 9,
    bothDirections: true,
  },
  paper: {
    textures: [],
    scale: range(180, 420),
    rotation: range(-180, 180),
    offset: range(0, 0.25),
    opacity: range(0.35, 0.7),
    blend: "multiply",
  },
  grain: {
    grain: range(0.1, 0.22),
    gain: range(1.4, 2.2),
    size: range(1.6, 3.4),
  },
  torn: {
    balance: range(0.44, 0.58),
    smoothness: range(0.3, 0.6),
    contrast: range(0.6, 0.85),
    roughness: range(0.35, 0.7),
  },
  wiggle: {
    amount: range(0, 6),
    rotation: range(-0.6, 0.6),
  },
  displace: {
    textures: [],
    amount: range(2, 9),
    scale: range(150, 400),
    rotation: range(-180, 180),
    offset: range(0, 0.3),
  },
  halftone: {
    cell: range(3, 6),
    angle: range(15, 75),
    strength: range(0.25, 0.55),
  },
  cutout: {
    textures: [],
    scale: range(100, 160),
    rotation: range(-180, 180),
    offset: range(0, 0.12),
    feather: range(0.05, 0.2),
    invert: false,
  },
  overlay: {
    textures: [],
    scale: range(150, 420),
    rotation: range(-180, 180),
    offset: range(0, 0.3),
    opacity: range(0.18, 0.45),
    blend: "screen",
  },
};
