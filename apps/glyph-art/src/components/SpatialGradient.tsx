import { presetEraList, findPreset } from "../presets";
import { reactionIcons } from "../reactions";
import { useGlyphArtStore } from "../store";
import type { SpatialGradient as Gradient } from "../types";
import { SliderControl } from "./RangeControl";

export function SpatialGradient() {
  const gradient = useGlyphArtStore((state) => state.settings.gradient);
  const enable = useGlyphArtStore((state) => state.enableSpatialGradient);
  const setGlobal = useGlyphArtStore((state) => state.setGlobal);
  const update = (value: Partial<Gradient>) => setGlobal("gradient", { ...gradient, ...value });
  const move = (index: number, delta: number) => {
    const steps = [...gradient.steps];
    [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]];
    update({ steps });
  };

  return <section className="panel-block spatial-gradient">
    <h2>step gradient</h2>
    <label className="check">
      <input type="checkbox" checked={gradient.enabled} onChange={(event) => enable(event.target.checked)} />
      blend steps across the image
    </label>
    <p className="control-hint">Each area keeps the source tone while its marks move through the steps.
      SVG uses the same marks and positions as the preview. Disable the gradient
      to edit your own tone bands and custom marks; they are retained.</p>
    {gradient.enabled && <>
      <label className="field">
        <span>direction</span>
        <select aria-label="gradient direction" value={gradient.direction}
          onChange={(event) => update({ direction: event.target.value as Gradient["direction"] })}>
          <option value="down">top → bottom</option>
          <option value="up">bottom → top</option>
          <option value="right">left → right</option>
          <option value="left">right → left</option>
        </select>
      </label>
      <SliderControl label="transition" value={gradient.blend} min={0} max={1} step={0.05}
        onChange={(blend) => update({ blend })} />
      <p className="control-hint">0 gives distinct areas; 1 mixes throughout each transition.
        Move a step to change the order, or choose its foreign-print variant.</p>
      <details className="step-details">
      <summary>steps · order and variants</summary>
      <ol className="gradient-steps">
        {gradient.steps.map((id, index) => {
          const preset = findPreset(id)!;
          const era = presetEraList.find((entry) => entry.label === preset.era)!;
          const last = id === "digital-reactions";
          return <li key={`${index}:${id}`}>
            <div className="gradient-step-name"><span>{index + 1}.</span><span>{preset.era}</span></div>
            <div className="gradient-step-controls">
              <select aria-label={`step ${index + 1} variant`} value={id} disabled={era.presets.length < 2}
                onChange={(event) => update({ steps: gradient.steps.map((step, at) => at === index ? event.target.value : step) })}>
                {era.presets.map((entry) => <option key={entry.id} value={entry.id}>{entry.variant}</option>)}
              </select>
              <button type="button" aria-label={`move step ${index + 1} up`} disabled={index === 0 || last}
                onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label={`move step ${index + 1} down`}
                disabled={last || index === gradient.steps.length - 1 || gradient.steps[index + 1] === "digital-reactions"}
                onClick={() => move(index, 1)}>↓</button>
            </div>
          </li>;
        })}
      </ol>
      </details>
    </>}
    <div className="reaction-samples" aria-label="digital reactions: fire, salute, views, two-digit counters">
      {Object.entries(reactionIcons).map(([id, icon]) =>
        <svg key={id} role="img" aria-label={id} viewBox={`0 0 ${icon.width} ${icon.height}`}>
          <path fill="currentColor" d={icon.path} />
        </svg>)}
      <span>1,7k · 16k · 3,2k</span>
    </div>
    <p className="control-hint">Digital reactions: fire, press F / salute, views and 180 counters.
      The eye is a separate mark; tiny levels use counters only, and dark levels
      keep counters in the majority. Always two digits: 1,7k or 17k, never 17,1k.
      Roboto Medium counters and the original press F trace export as curves.</p>
  </section>;
}
