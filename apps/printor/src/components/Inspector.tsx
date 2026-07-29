import { RangeControl } from "./RangeControl";
import { usePrintorStore } from "../store";
import { defaultSettings } from "../types";

const layerNames = {
  levels: "Levels",
  noise: "Noise",
  print: "Dither / halftone",
  paper: "Paper scan",
};

export function Inspector() {
  const selected = usePrintorStore((state) => state.selectedLayer);
  const settings = usePrintorStore((state) => state.settings);
  const set = usePrintorStore((state) => state.setSetting);

  return (
    <aside className="panel inspector" aria-labelledby="inspector-title">
      <h2 id="inspector-title">Inspector</h2>
      <p className="inspector-name">{layerNames[selected]}</p>
      {selected === "levels" && (
        <>
          <RangeControl label="brightness" value={settings.brightness} min={-0.5} max={0.5} step={0.01} defaultValue={defaultSettings.brightness} onChange={(value) => set("brightness", value)} />
          <RangeControl label="contrast" value={settings.contrast} min={0.4} max={2.5} step={0.01} defaultValue={defaultSettings.contrast} onChange={(value) => set("contrast", value)} />
          <RangeControl label="gamma" value={settings.gamma} min={0.25} max={2.5} step={0.01} defaultValue={defaultSettings.gamma} onChange={(value) => set("gamma", value)} />
        </>
      )}
      {selected === "noise" && (
        <>
          <RangeControl label="amount" value={settings.noise} min={0} max={0.6} step={0.01} defaultValue={defaultSettings.noise} onChange={(value) => set("noise", value)} />
          <RangeControl label="size" value={settings.noiseSize} min={1} max={8} step={1} defaultValue={defaultSettings.noiseSize} onChange={(value) => set("noiseSize", value)} format={(value) => `${value}px`} />
        </>
      )}
      {selected === "print" && (
        <>
          <div className="segmented" aria-label="Print mode">
            <button type="button" className={settings.printMode === "dither" ? "active" : ""} onClick={() => set("printMode", "dither")}>dither</button>
            <button type="button" className={settings.printMode === "halftone" ? "active" : ""} onClick={() => set("printMode", "halftone")}>halftone</button>
          </div>
          {settings.printMode === "dither" ? (
            <>
              <RangeControl label="levels" value={settings.levels} min={2} max={16} step={1} defaultValue={defaultSettings.levels} onChange={(value) => set("levels", value)} />
              <RangeControl label="threshold" value={settings.threshold} min={0.1} max={0.9} step={0.01} defaultValue={defaultSettings.threshold} onChange={(value) => set("threshold", value)} />
            </>
          ) : (
            <>
              <RangeControl label="dot size" value={settings.halftoneScale} min={3} max={24} step={1} defaultValue={defaultSettings.halftoneScale} onChange={(value) => set("halftoneScale", value)} format={(value) => `${value}px`} />
              <RangeControl label="dot gain" value={settings.dotGain} min={-0.5} max={0.5} step={0.01} defaultValue={defaultSettings.dotGain} onChange={(value) => set("dotGain", value)} />
            </>
          )}
        </>
      )}
      {selected === "paper" && (
        <>
          <RangeControl label="paper" value={settings.paper} min={0} max={0.6} step={0.01} defaultValue={defaultSettings.paper} onChange={(value) => set("paper", value)} />
          <RangeControl label="banding" value={settings.banding} min={0} max={0.6} step={0.01} defaultValue={defaultSettings.banding} onChange={(value) => set("banding", value)} />
        </>
      )}
      <p className="panel-note">Alt-click a control to reset it.</p>
    </aside>
  );
}
