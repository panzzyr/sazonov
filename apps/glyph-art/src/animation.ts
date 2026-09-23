import {
  maxGrid,
  minGrid,
  type GridAnimation,
  type GridKeyframe,
  type Settings,
} from "./types";

type GridTimelineSettings = Pick<Settings, "animation" | "grid" | "mode">;

export function frameProgress(frame: number, total: number) {
  if (total <= 1) return 0;
  return Math.max(0, Math.min(1, frame / (total - 1)));
}

function eased(progress: number, interpolation: GridAnimation["interpolation"]) {
  if (interpolation === "hold") return 0;
  if (interpolation === "ease-in-out") return progress * progress * (3 - 2 * progress);
  return progress;
}

/** Grid density at one point in a clip. Keyframes may arrive unsorted from UI edits. */
export function gridAtProgress(settings: GridTimelineSettings, progress: number) {
  const animation = settings.animation;
  if (!animation.enabled || settings.mode !== "glyph" || animation.keyframes.length === 0) {
    return settings.grid;
  }

  const keyframes = [...animation.keyframes].sort((a, b) => a.at - b.at);
  const at = Math.max(0, Math.min(1, progress));
  if (at <= keyframes[0].at) return keyframes[0].grid;
  if (at >= keyframes[keyframes.length - 1].at) return keyframes[keyframes.length - 1].grid;
  const exact = keyframes.find((keyframe) => Math.abs(keyframe.at - at) < 1e-9);
  if (exact) return exact.grid;

  const rightIndex = keyframes.findIndex((keyframe) => keyframe.at >= at);
  const left = keyframes[Math.max(0, rightIndex - 1)];
  const right = keyframes[rightIndex];
  if (right.at === left.at) return right.grid;
  const local = (at - left.at) / (right.at - left.at);
  const amount = eased(local, animation.interpolation);
  return Math.max(minGrid, Math.min(maxGrid, Math.round(left.grid + (right.grid - left.grid) * amount)));
}

export function settingsAtFrame(settings: Settings, frame: number, total: number): Settings {
  const grid = gridAtProgress(settings, frameProgress(frame, total));
  return grid === settings.grid ? settings : { ...settings, grid };
}

/** A dense reference grid keeps the fixed export frame closest to the source aspect. */
export function referenceGrid(settings: Settings) {
  if (!settings.animation.enabled || settings.mode !== "glyph") return settings.grid;
  return Math.max(settings.grid, ...settings.animation.keyframes.map((keyframe) => keyframe.grid));
}

export function sortedKeyframes(keyframes: GridKeyframe[]) {
  return [...keyframes].sort((a, b) => a.at - b.at);
}
