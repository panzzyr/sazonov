/** Conservative catalogue screening, evaluated offline on the measured scans. */
export type ScanQuality = { blur: number; edge: number };

export const minimumScanEdge = 16;
export const maximumScanBlur = 3.5;
export const softTailPercentile = 0.98;

/** Compare softness within a scan source, not between different print traditions. */
export function scanBlurLimit(marks: readonly ScanQuality[]) {
  const values = marks.map((mark) => mark.blur).filter(Number.isFinite).sort((a, b) => a - b);
  return Math.max(maximumScanBlur, values[Math.floor((values.length - 1) * softTailPercentile)] ?? maximumScanBlur);
}

export function rejectsScan(mark: ScanQuality, blurLimit: number) {
  return !Number.isFinite(mark.blur) || mark.blur > blurLimit || mark.edge < minimumScanEdge;
}
