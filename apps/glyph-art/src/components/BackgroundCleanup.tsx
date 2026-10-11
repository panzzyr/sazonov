import { SliderControl } from "./RangeControl";
import { Icon } from "./Icons";
import type { BackgroundCleanup as Cleanup } from "../types";

export function BackgroundCleanup({ value, onChange }: {
  value: Cleanup;
  onChange: (value: Cleanup, editKey?: string) => void;
}) {
  return <section className="panel-block">
    <h2><Icon name="tone" />background cleanup</h2>
    {(["black", "white"] as const).map((side) => <div key={side}>
      <label className="check">
        <input type="checkbox" checked={value[side]}
          onChange={(event) => onChange({ ...value, [side]: event.target.checked })} />
        remove {side} background
      </label>
      {value[side] && <SliderControl label={`${side} tolerance`}
        value={value[`${side}Tolerance`] * 100} min={0} max={49} step={0.1} unit="%"
        onChange={(tolerance) => onChange({ ...value, [`${side}Tolerance`]: tolerance / 100 }, `cleanup.${side}`)} />}
    </div>)}
    <SliderControl label="minimum mark" value={value.minSize * 100} min={5} max={100} unit="% cell"
      onChange={(minSize) => onChange({ ...value, minSize: minSize / 100 }, "cleanup.minSize")} />
    <p className="control-hint">
      Remove near-black or near-white source cells before levels and inversion.
      0% clips only pure black/white; raise tolerance for compressed video.
      Minimum mark removes tiny marks everywhere, not just the background. All exports use these filters.
    </p>
  </section>;
}
