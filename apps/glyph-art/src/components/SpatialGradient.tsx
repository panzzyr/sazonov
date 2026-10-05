import { useState } from "react";
import { presetEraList, findPreset, defaultGradientSteps } from "../presets";
import { reactionIcons } from "../reactions";
import { useGlyphArtStore } from "../store";
import { minGradientSteps, maxGradientSteps, type SpatialGradient as Gradient } from "../types";
import { SliderControl } from "./RangeControl";

function PresetOptions({ compact = false }: { compact?: boolean }) {
  return presetEraList.map((era) => <optgroup key={era.label} label={era.label}>
    {era.presets.map((preset) => <option key={preset.id} value={preset.id}>
      {compact ? preset.variant : `${preset.era} · ${preset.variant}`}
    </option>)}
  </optgroup>);
}

export function SpatialGradient() {
  const [newStep, setNewStep] = useState(presetEraList[0].presets[0].id);
  const gradient = useGlyphArtStore((state) => state.settings.gradient);
  const enable = useGlyphArtStore((state) => state.enableSpatialGradient);
  const setGlobal = useGlyphArtStore((state) => state.setGlobal);
  const update = (value: Partial<Gradient>) => setGlobal("gradient", { ...gradient, ...value });
  const move = (index: number, delta: number) => {
    if (index + delta < 0 || index + delta >= gradient.steps.length) return;
    const steps = [...gradient.steps];
    [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]];
    update({ steps });
  };
  const remove = (index: number) => {
    if (gradient.steps.length <= minGradientSteps) return;
    update({ steps: gradient.steps.filter((_, at) => at !== index) });
  };
  const add = () => {
    if (gradient.steps.length >= maxGradientSteps) return;
    const steps = [...gradient.steps];
    // Retain the usual reaction finale when adding another historical step.
    const at = steps.at(-1) === "digital-reactions" && newStep !== "digital-reactions"
      ? steps.length - 1 : steps.length;
    steps.splice(at, 0, newStep);
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
        Choose any preset for each step, remove unwanted steps, or add more.
        Keep at least two steps; arrows change their order.</p>
      <div className="button-row">
        <button type="button" disabled={gradient.steps.length <= minGradientSteps}
          onClick={() => update({ steps: [gradient.steps[0], gradient.steps[gradient.steps.length - 1]] })}>
          keep first + last
        </button>
        <button type="button" onClick={() => update({ steps: defaultGradientSteps() })}>all steps</button>
      </div>
      <details className="step-details">
      <summary>steps · {gradient.steps.length} selected</summary>
      <ol className="gradient-steps">
        {gradient.steps.map((id, index) => {
          const preset = findPreset(id)!;
          return <li key={`${index}:${id}`}>
            <div className="gradient-step-name"><span>{index + 1}.</span><span>{preset.era}</span></div>
            <div className="gradient-step-controls">
              <select aria-label={`step ${index + 1} preset`} value={id}
                onChange={(event) => update({ steps: gradient.steps.map((step, at) => at === index ? event.target.value : step) })}>
                <PresetOptions compact />
              </select>
              <button type="button" aria-label={`move step ${index + 1} up`} disabled={index === 0}
                onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label={`move step ${index + 1} down`}
                disabled={index === gradient.steps.length - 1}
                onClick={() => move(index, 1)}>↓</button>
              <button type="button" aria-label={`remove step ${index + 1}`} title="Remove this step"
                disabled={gradient.steps.length <= minGradientSteps} onClick={() => remove(index)}>×</button>
            </div>
          </li>;
        })}
      </ol>
      <div className="field">
        <select aria-label="new step preset" value={newStep} onChange={(event) => setNewStep(event.target.value)}>
          <PresetOptions />
        </select>
        <button type="button" disabled={gradient.steps.length >= maxGradientSteps} onClick={add}>add step</button>
      </div>
      <p className="control-hint">{minGradientSteps}–{maxGradientSteps} steps. Changes can be undone;
        projects and links keep only the selected steps.</p>
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
