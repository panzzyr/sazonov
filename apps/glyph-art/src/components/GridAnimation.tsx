import { useEffect, useMemo, useState } from "react";
import { frameProgress, gridAtProgress, sortedKeyframes } from "../animation";
import {
  maxGrid,
  maxGridKeyframes,
  minGrid,
  type GridAnimation as GridAnimationSettings,
} from "../types";
import { Icon } from "./Icons";

type Props = {
  animation: GridAnimationSettings;
  baseGrid: number;
  frame: number;
  totalFrames: number;
  onFrameChange: (frame: number) => void;
  onChange: (animation: GridAnimationSettings, editKey?: string) => void;
  onEnable: () => void;
};

function percent(at: number) {
  return `${Math.round(at * 100)}%`;
}

export function GridAnimation({
  animation,
  baseGrid,
  frame,
  totalFrames,
  onFrameChange,
  onChange,
  onEnable,
}: Props) {
  const [selectedAt, setSelectedAt] = useState<number | null>(null);
  const keyframes = useMemo(() => sortedKeyframes(animation.keyframes), [animation.keyframes]);
  const progress = frameProgress(frame, totalFrames);
  const currentGrid = gridAtProgress({
    mode: "glyph",
    grid: baseGrid,
    animation,
  }, progress);

  useEffect(() => {
    if (selectedAt !== null && !keyframes.some((keyframe) => keyframe.at === selectedAt)) {
      setSelectedAt(null);
    }
  }, [keyframes, selectedAt]);

  const replace = (at: number, values: Partial<(typeof keyframes)[number]>, editKey: string) => {
    const nextAt = values.at ?? at;
    const next = keyframes
      .filter((keyframe) => keyframe.at === at || keyframe.at !== nextAt)
      .map((keyframe) => keyframe.at === at ? { ...keyframe, ...values } : keyframe);
    onChange({ ...animation, keyframes: sortedKeyframes(next) }, editKey);
    if (values.at !== undefined) setSelectedAt(values.at);
  };

  const add = () => {
    const at = Number(progress.toFixed(4));
    const existing = keyframes.find((keyframe) => Math.abs(keyframe.at - at) < 0.001);
    if (existing) {
      setSelectedAt(existing.at);
      return;
    }
    if (keyframes.length >= maxGridKeyframes) return;
    onChange({
      ...animation,
      keyframes: sortedKeyframes([...keyframes, { at, grid: currentGrid }]),
    });
    setSelectedAt(at);
  };

  const remove = (at: number) => {
    onChange({ ...animation, keyframes: keyframes.filter((keyframe) => keyframe.at !== at) });
    setSelectedAt(null);
  };

  return (
    <section className="panel-block animation-panel">
      <h2><Icon name="timing" />grid animation</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={animation.enabled}
          onChange={(event) => {
            if (event.target.checked) onEnable();
            else onChange({ ...animation, enabled: false });
          }}
        />
        animate cells
      </label>

      {animation.enabled && (
        <>
          <div className="animation-readout">
            <span>{percent(progress)}</span>
            <strong>{currentGrid} cell{currentGrid === 1 ? "" : "s"}</strong>
          </div>
          <div className="animation-track" aria-label="Grid keyframe timeline">
            <input
              type="range"
              min={0}
              max={Math.max(0, totalFrames - 1)}
              value={Math.min(frame, Math.max(0, totalFrames - 1))}
              aria-label="Animation playhead"
              disabled={totalFrames < 2}
              onChange={(event) => onFrameChange(Number(event.target.value))}
            />
            {keyframes.map((keyframe) => (
              <button
                key={keyframe.at}
                type="button"
                className="animation-marker"
                style={{ left: `${keyframe.at * 100}%` }}
                aria-label={`Keyframe at ${percent(keyframe.at)}, ${keyframe.grid} cell${keyframe.grid === 1 ? "" : "s"}`}
                aria-pressed={selectedAt === keyframe.at}
                onClick={() => {
                  setSelectedAt(keyframe.at);
                  onFrameChange(Math.round(keyframe.at * Math.max(0, totalFrames - 1)));
                }}
              />
            ))}
          </div>

          <div className="button-row">
            <button type="button" onClick={add} disabled={keyframes.length >= maxGridKeyframes}>
              add at playhead
            </button>
          </div>

          <div className="field animation-easing">
            <label htmlFor="grid-interpolation">between</label>
            <select
              id="grid-interpolation"
              value={animation.interpolation}
              onChange={(event) => onChange({
                ...animation,
                interpolation: event.target.value as GridAnimationSettings["interpolation"],
              })}
            >
              <option value="ease-in-out">ease in/out</option>
              <option value="linear">linear</option>
              <option value="hold">hold</option>
            </select>
          </div>

          <div className="keyframe-list">
            {keyframes.map((keyframe) => (
              <div
                className={`keyframe-row${selectedAt === keyframe.at ? " selected" : ""}`}
                key={keyframe.at}
              >
                <button
                  type="button"
                  className="keyframe-jump"
                  aria-label={`Select keyframe at ${percent(keyframe.at)}`}
                  onClick={() => {
                    setSelectedAt(keyframe.at);
                    onFrameChange(Math.round(keyframe.at * Math.max(0, totalFrames - 1)));
                  }}
                >
                  ◆
                </button>
                <label>
                  <span>at</span>
                  <input
                    className="number-entry"
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(keyframe.at * 100)}
                    aria-label="Keyframe position in percent"
                    onChange={(event) => replace(
                      keyframe.at,
                      { at: Math.max(0, Math.min(1, Number(event.target.value) / 100)) },
                      `animation.${keyframe.at}.at`,
                    )}
                  />
                  <span>%</span>
                </label>
                <label>
                  <span>cells</span>
                  <input
                    className="number-entry"
                    type="number"
                    min={minGrid}
                    max={maxGrid}
                    value={keyframe.grid}
                    aria-label="Cells at keyframe"
                    onChange={(event) => replace(
                      keyframe.at,
                      { grid: Math.max(minGrid, Math.min(maxGrid, Math.round(Number(event.target.value)))) },
                      `animation.${keyframe.at}.grid`,
                    )}
                  />
                </label>
                <button
                  type="button"
                  className="keyframe-remove"
                  aria-label={`Remove keyframe at ${percent(keyframe.at)}`}
                  disabled={keyframes.length <= 1}
                  onClick={() => remove(keyframe.at)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <p className="control-hint">
            Keyframes use clip position, so they survive frame-rate and duration changes.
            SVG exports the frame under the playhead; PNG and MP4 export the full motion.
          </p>
        </>
      )}
    </section>
  );
}
