import { RangeControl, SliderControl } from "./RangeControl";
import { TexturePicker } from "./TexturePicker";
import { stageIsTextured } from "./PipelinePanel";
import { usePrintorStore } from "../store";
import {
  blendModes,
  stageHints,
  stageLabels,
  type BlendMode,
  type PlacementSettings,
  type Range,
  type StageId,
} from "../types";

/** Scale, rotation, and offset are shared by every texture-backed stage. */
function PlacementControls({ stage }: { stage: "paper" | "displace" | "cutout" | "overlay" }) {
  const settings = usePrintorStore((state) => state.settings[stage]) as PlacementSettings;
  const updateStage = usePrintorStore((state) => state.updateStage);
  const set = (patch: Partial<PlacementSettings>, key: string) =>
    updateStage(stage, patch as never, `${stage}.${key}`);

  return (
    <>
      <RangeControl
        label="scale"
        value={settings.scale}
        min={100}
        max={1000}
        step={10}
        unit="%"
        hint="100% fits the frame. Push higher on small sources so the grain reads."
        onChange={(scale) => set({ scale }, "scale")}
      />
      <RangeControl
        label="rotation"
        value={settings.rotation}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(rotation) => set({ rotation }, "rotation")}
      />
      <RangeControl
        label="offset"
        value={settings.offset}
        min={0}
        max={1}
        step={0.01}
        hint="Distance from centre as a fraction of the frame; direction is random."
        onChange={(offset) => set({ offset }, "offset")}
      />
    </>
  );
}

function BlendSelect({
  value,
  onChange,
}: {
  value: BlendMode;
  onChange: (mode: BlendMode) => void;
}) {
  return (
    <label className="select-control">
      <span>blend</span>
      <select value={value} onChange={(event) => onChange(event.target.value as BlendMode)}>
        {blendModes.map((mode) => (
          <option key={mode} value={mode}>{mode}</option>
        ))}
      </select>
    </label>
  );
}

function StageBody({ stage }: { stage: StageId }) {
  const settings = usePrintorStore((state) => state.settings);
  const updateStage = usePrintorStore((state) => state.updateStage);
  const key = (name: string) => `${stage}.${name}`;

  switch (stage) {
    case "motion": {
      const motion = settings.motion;
      return (
        <>
          <RangeControl
            label="blur"
            value={motion.strength}
            min={0}
            max={80}
            step={0.5}
            unit=" px"
            precision={1}
            onChange={(strength) => updateStage("motion", { strength }, key("strength"))}
          />
          <RangeControl
            label="angle"
            value={motion.angle}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(angle) => updateStage("motion", { angle }, key("angle"))}
          />
          <SliderControl
            label="samples"
            value={motion.samples}
            min={2}
            max={24}
            onChange={(samples) => updateStage("motion", { samples }, key("samples"))}
          />
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={motion.bothDirections}
              onChange={(event) => updateStage("motion", { bothDirections: event.target.checked })}
            />
            <span>blur both directions</span>
          </label>
        </>
      );
    }

    case "paper": {
      const paper = settings.paper;
      return (
        <>
          <TexturePicker stage="paper" />
          <PlacementControls stage="paper" />
          <RangeControl
            label="opacity"
            value={paper.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(opacity) => updateStage("paper", { opacity }, key("opacity"))}
          />
          <BlendSelect value={paper.blend} onChange={(blend) => updateStage("paper", { blend })} />
        </>
      );
    }

    case "grain": {
      const grain = settings.grain;
      return (
        <>
          <RangeControl
            label="grain"
            value={grain.grain}
            min={0}
            max={1}
            step={0.01}
            hint="Noise added before the threshold. This is what speckles the fill."
            onChange={(value) => updateStage("grain", { grain: value }, key("grain"))}
          />
          <RangeControl
            label="gain"
            value={grain.gain}
            min={0}
            max={6}
            step={0.05}
            hint="Contrast into the threshold. Higher gain means fewer mid-tones survive."
            onChange={(gain) => updateStage("grain", { gain }, key("gain"))}
          />
          <RangeControl
            label="grain size"
            value={grain.size}
            min={1}
            max={16}
            step={0.1}
            unit=" px"
            precision={1}
            onChange={(size) => updateStage("grain", { size }, key("size"))}
          />
        </>
      );
    }

    case "torn": {
      const torn = settings.torn;
      return (
        <>
          <RangeControl
            label="image balance"
            value={torn.balance}
            min={0}
            max={1}
            step={0.01}
            hint="Where the threshold sits. Lower keeps more ink."
            onChange={(balance) => updateStage("torn", { balance }, key("balance"))}
          />
          <RangeControl
            label="smoothness"
            value={torn.smoothness}
            min={0}
            max={1}
            step={0.01}
            hint="Size of the torn fibre. Low is frayed, high is a calm coastline."
            onChange={(smoothness) => updateStage("torn", { smoothness }, key("smoothness"))}
          />
          <RangeControl
            label="contrast"
            value={torn.contrast}
            min={0}
            max={1}
            step={0.01}
            hint="Hardness of the edge. High is a clean silkscreen cut."
            onChange={(contrast) => updateStage("torn", { contrast }, key("contrast"))}
          />
          <RangeControl
            label="roughness"
            value={torn.roughness}
            min={0}
            max={1.5}
            step={0.01}
            hint="How far the edge is allowed to wander from the true outline."
            onChange={(roughness) => updateStage("torn", { roughness }, key("roughness"))}
          />
        </>
      );
    }

    case "wiggle": {
      const wiggle = settings.wiggle;
      return (
        <>
          <RangeControl
            label="shift"
            value={wiggle.amount}
            min={0}
            max={60}
            step={0.5}
            unit=" px"
            precision={1}
            hint="Per-frame registration drift; direction is redrawn each frame."
            onChange={(amount) => updateStage("wiggle", { amount }, key("amount"))}
          />
          <RangeControl
            label="rotation"
            value={wiggle.rotation}
            min={-8}
            max={8}
            step={0.1}
            unit="°"
            precision={1}
            onChange={(rotation) => updateStage("wiggle", { rotation }, key("rotation"))}
          />
        </>
      );
    }

    case "displace": {
      const displace = settings.displace;
      return (
        <>
          <TexturePicker stage="displace" />
          <RangeControl
            label="amount"
            value={displace.amount}
            min={0}
            max={60}
            step={0.5}
            unit=" px"
            precision={1}
            hint="Peak warp. The map's slope decides the direction."
            onChange={(amount) => updateStage("displace", { amount }, key("amount"))}
          />
          <PlacementControls stage="displace" />
        </>
      );
    }

    case "halftone": {
      const halftone = settings.halftone;
      return (
        <>
          <RangeControl
            label="cell"
            value={halftone.cell}
            min={1.5}
            max={32}
            step={0.5}
            unit=" px"
            precision={1}
            hint="Screen pitch. Small cells read as a fine print, large as a poster."
            onChange={(cell) => updateStage("halftone", { cell }, key("cell"))}
          />
          <RangeControl
            label="angle"
            value={halftone.angle}
            min={-90}
            max={90}
            step={1}
            unit="°"
            onChange={(angle) => updateStage("halftone", { angle }, key("angle"))}
          />
          <RangeControl
            label="strength"
            value={halftone.strength}
            min={0}
            max={1}
            step={0.01}
            onChange={(strength) => updateStage("halftone", { strength }, key("strength"))}
          />
        </>
      );
    }

    case "cutout": {
      const cutout = settings.cutout;
      return (
        <>
          <TexturePicker stage="cutout" />
          <PlacementControls stage="cutout" />
          <RangeControl
            label="feather"
            value={cutout.feather}
            min={0}
            max={0.5}
            step={0.005}
            hint="Softness of the torn paper edge."
            onChange={(feather) => updateStage("cutout", { feather }, key("feather"))}
          />
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={cutout.invert}
              onChange={(event) => updateStage("cutout", { invert: event.target.checked })}
            />
            <span>invert mask</span>
          </label>
        </>
      );
    }

    case "overlay": {
      const overlay = settings.overlay;
      return (
        <>
          <TexturePicker stage="overlay" />
          <PlacementControls stage="overlay" />
          <RangeControl
            label="opacity"
            value={overlay.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(opacity) => updateStage("overlay", { opacity }, key("opacity"))}
          />
          <BlendSelect value={overlay.blend} onChange={(blend) => updateStage("overlay", { blend })} />
        </>
      );
    }
  }
}

export function StageInspector() {
  const stage = usePrintorStore((state) => state.selectedStage);
  const state = usePrintorStore((current) => current.settings.stages[stage]);
  const setStageEnabled = usePrintorStore((current) => current.setStageEnabled);
  const setFrameChance = usePrintorStore((current) => current.setFrameChance);

  const chance: Range = { min: state.frameChance, max: state.frameChance };

  return (
    <section className="inspector" aria-label={`${stageLabels[stage]} settings`}>
      <div className="panel-heading">
        <h2>{stageLabels[stage]}</h2>
        <label className="toggle-control compact">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(event) => setStageEnabled(stage, event.target.checked)}
          />
          <span>on</span>
        </label>
      </div>
      <p className="stage-hint">{stageHints[stage]}</p>

      <SliderControl
        label="applied on"
        value={Math.round(chance.min * 100)}
        min={0}
        max={100}
        unit="% of frames"
        onChange={(percent) => setFrameChance(stage, percent / 100)}
      />

      <div className={`stage-controls${state.enabled ? "" : " disabled"}`}>
        <StageBody stage={stage} />
      </div>
      {stageIsTextured(stage) && (
        <p className="control-hint">
          Each frame draws one texture from the selection at random.
        </p>
      )}
    </section>
  );
}
