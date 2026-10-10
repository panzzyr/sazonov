import { useEffect, useRef } from "react";
import { SliderControl } from "./RangeControl";
import { minHold, maxHold, type SymbolHold as Hold } from "../types";

/** Infinite hold changes only cycling, not playback, frame count or grid motion. */
export function SymbolHold({ value, onChange, showFinite = true }: {
  value: Hold; onChange: (value: Hold) => void; showFinite?: boolean;
}) {
  const finite = useRef(typeof value === "number" ? value : 2);
  useEffect(() => {
    if (typeof value === "number") finite.current = value;
  }, [value]);
  return <>
    <label className="check">
      <input type="checkbox" checked={value === "infinite"}
        onChange={(event) => onChange(event.target.checked ? "infinite" : finite.current)} />
      hold infinite
    </label>
    {showFinite && typeof value === "number" && <SliderControl label="hold" value={value}
      min={minHold} max={maxHold} onChange={(next) => onChange(Math.round(next))} />}
  </>;
}
