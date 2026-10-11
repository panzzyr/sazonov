import { NumberEntry } from "./RangeControl";
import { rangeFromSeconds } from "../export/renderSequence";
import { canSaveDirectory, canSaveFile } from "../export/fileOutput";
import type { ExportFormat } from "../types";

export type ExportWindowValue = { enabled: boolean; start: number; end: number | null };

export function ExportWindow({ value, onChange, format, frames, fps, direct, onDirect }: {
  value: ExportWindowValue;
  onChange: (value: ExportWindowValue) => void;
  format: ExportFormat;
  frames: number;
  fps: number;
  direct: boolean;
  onDirect: (value: boolean) => void;
}) {
  if (format === "svg") return null;
  const duration = frames / fps;
  const end = Math.max(1 / fps, Math.min(value.end ?? duration, duration));
  const start = Math.max(0, Math.min(value.start, end - 1 / fps));
  const range = value.enabled ? rangeFromSeconds(frames, fps, start, end) : { start: 0, end: frames };
  const canDirect = format === "png" ? canSaveDirectory() : canSaveFile();
  return <>
    <label className="check">
      <input type="checkbox" checked={value.enabled}
        onChange={(event) => onChange({ ...value, enabled: event.target.checked })} />
      export selected interval
    </label>
    {value.enabled && <div className="blend-times">
      <label className="blend-time"><span>start · s</span>
        <NumberEntry label="export start value" value={start} min={0} max={Math.max(0, end - 1 / fps)}
          step={1 / fps} precision={3} onChange={(start) => onChange({ ...value, start })} />
      </label>
      <label className="blend-time"><span>end · s</span>
        <NumberEntry label="export end value" value={end} min={start + 1 / fps} max={duration}
          step={1 / fps} precision={3} onChange={(end) => onChange({ ...value, end })} />
      </label>
    </div>}
    <p className="control-hint">
      Export: {range.end - range.start} frames · {((range.end - range.start) / fps).toFixed(2)} s.
      {value.enabled && " Animation clocks stay on the full timeline; trimming does not restart them."}
    </p>
    {canDirect && <label className="check">
      <input type="checkbox" checked={direct} onChange={(event) => onDirect(event.target.checked)} />
      save directly to disk
    </label>}
    <p className="control-hint">
      {canDirect && direct
        ? format === "png" ? "Choose a folder for numbered ZIP parts; frames are written as they render."
          : "Choose one MP4 file; encoded video streams to disk instead of accumulating in memory."
        : "Downloads use numbered parts for long clips. Allow multiple downloads if the browser asks. No frames are skipped."}
    </p>
  </>;
}
