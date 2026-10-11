import { useId } from "react";
import { NumberEntry, SliderControl } from "./RangeControl";
import { Icon } from "./Icons";
import { fitSymbolBlend } from "../engine/symbolBlend";
import { maxTimelineSeconds, type SymbolBlend as Blend } from "../types";

export function SymbolBlend({ blend, frames, fps, frame, looping, onChange, onEnable }: {
  blend: Blend;
  frames: number;
  fps: number;
  frame: number;
  looping: boolean;
  onChange: (blend: Blend, editKey?: string) => void;
  onEnable: () => void;
}) {
  const id = useId();
  const lastTime = Math.max(0, frames - 1) / fps;
  const enterEnd = blend.enterStart + blend.enterDuration;
  const exitEnd = blend.exitStart + blend.exitDuration;
  const outside = enterEnd > lastTime + 1e-7 || (blend.exitEnabled && exitEnd > lastTime + 1e-7);
  const seconds = (key: "enterStart" | "enterDuration" | "exitStart" | "exitDuration", label: string) =>
    <label className="blend-time">
      <span>{label} <span className="control-unit">s</span></span>
      <NumberEntry label={`${label} value`} value={blend[key]} min={0} max={maxTimelineSeconds}
        step={0.01} precision={2} onChange={(value) => onChange({ ...blend, [key]: value }, `blend.${key}`)} />
    </label>;
  const bar = (start: number, duration: number) => ({
    left: `${Math.min(100, start / Math.max(lastTime, 0.001) * 100)}%`,
    width: `${Math.max(0, Math.min(duration, lastTime - start) / Math.max(lastTime, 0.001) * 100)}%`,
  });

  return <section className="panel-block">
    <h2><Icon name="timing" />appearance / blend</h2>
    <label className="check">
      <input type="checkbox" checked={blend.enabled} onChange={(event) => {
        if (event.target.checked) onEnable();
        else onChange({ ...blend, enabled: false });
      }} />
      animate appearance
    </label>
    {blend.enabled && <>
      <div className="blend-clock" role="img"
        aria-label={`Appear from ${blend.enterStart.toFixed(2)} to ${enterEnd.toFixed(2)} seconds; ${blend.exitEnabled
          ? `disappear from ${blend.exitStart.toFixed(2)} to ${exitEnd.toFixed(2)} seconds` : "stay visible"}`}>
        <div><span>in</span><div className="blend-track"><i style={bar(blend.enterStart, blend.enterDuration)} /></div></div>
        {blend.exitEnabled && <div><span>out</span><div className="blend-track"><i style={bar(blend.exitStart, blend.exitDuration)} /></div></div>}
        <p>{(frame / fps).toFixed(2)} / {lastTime.toFixed(2)} s · current frame</p>
      </div>
      <div className="blend-times">
        {seconds("enterStart", "appear at")}
        {seconds("enterDuration", "appear over")}
      </div>
      <label className="check">
        <input type="checkbox" checked={blend.exitEnabled}
          onChange={(event) => onChange({ ...blend, exitEnabled: event.target.checked })} />
        disappear afterwards
      </label>
      {blend.exitEnabled && <div className="blend-times">
        {seconds("exitStart", "disappear at")}
        {seconds("exitDuration", "disappear over")}
      </div>}
      <details className="control-details">
        <summary>fade &amp; departure order</summary>
        <SliderControl label="per-symbol fade" value={blend.fade} min={0} max={5} step={0.01} unit=" s"
          onChange={(fade) => onChange({ ...blend, fade }, "blend.fade")} />
        <p className="control-hint">Fade is capped by each phase. Keep it shorter than the phase for staggered onsets.</p>
        {blend.exitEnabled && <div className="field">
          <label htmlFor={id}>departure</label>
          <select id={id} value={blend.exitOrder} onChange={(event) => onChange({ ...blend,
            exitOrder: event.target.value as Blend["exitOrder"] })}>
            <option value="same">same order</option>
            <option value="reverse">reverse order</option>
            <option value="random">independent random</option>
          </select>
        </div>}
      </details>
      <div className="button-row">
        <button type="button" disabled={frames < 2}
          onClick={() => onChange(fitSymbolBlend(blend, frames, fps))}>fit appearance to clip</button>
      </div>
      {outside && <p className="control-hint" role="status">
        This clip ends before the appearance timeline finishes. Increase frames or fit appearance to clip.
      </p>}
      {blend.exitEnabled && blend.exitStart < enterEnd && <p className="control-hint" role="status">
        Appearance and departure overlap; some cells may never become fully visible.
      </p>}
      {looping && (!blend.exitEnabled || outside || (blend.enterStart === 0 && blend.enterDuration === 0))
        && <p className="control-hint">For an empty-to-empty loop, finish departure by the last frame and keep an appearance interval.</p>}
      <p className="control-hint">
        Cells enter one by one in seeded random order, then leave. Choose scatter / matrix below
        for independent symbol changes while they are visible.
        Nothing moves or scales. Timing is in seconds; 0 fade switches instantly.
        Hold infinite freezes the symbols, not their appearance. SVG exports the visible frame.
      </p>
    </>}
  </section>;
}
