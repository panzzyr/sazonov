import { useId } from "react";
import type { Range } from "../types";

type RangeControlProps = {
  label: string;
  hint?: string;
  value: Range;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Digits shown in the readout; inferred from step when omitted. */
  precision?: number;
  onChange: (value: Range) => void;
};

function format(value: number, precision: number, unit: string) {
  return `${value.toFixed(precision)}${unit}`;
}

/**
 * A two-thumb range. Every effect parameter is a span rather than a value:
 * each frame draws its own number from inside it, which is what stops the
 * sequence from looking like one still image with a filter on it.
 */
export function RangeControl({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit = "",
  precision,
  onChange,
}: RangeControlProps) {
  const id = useId();
  const digits = precision ?? (step < 1 ? 2 : 0);
  const span = max - min || 1;
  const low = Math.min(value.min, value.max);
  const high = Math.max(value.min, value.max);
  const leftPercent = ((low - min) / span) * 100;
  const rightPercent = 100 - ((high - min) / span) * 100;

  return (
    <div className="range-control">
      <div className="range-head">
        <label htmlFor={`${id}-min`}>{label}</label>
        <output>
          {low === high
            ? format(low, digits, unit)
            : `${format(low, digits, "")} – ${format(high, digits, unit)}`}
        </output>
      </div>
      <div className="range-track">
        <div className="range-fill" style={{ left: `${leftPercent}%`, right: `${rightPercent}%` }} />
        <input
          id={`${id}-min`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={low}
          aria-label={`${label} minimum`}
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange({ min: Math.min(next, high), max: high });
          }}
        />
        <input
          id={`${id}-max`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={high}
          aria-label={`${label} maximum`}
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange({ min: low, max: Math.max(next, low) });
          }}
        />
      </div>
      {hint && <p className="control-hint">{hint}</p>}
    </div>
  );
}

type SliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  precision?: number;
  onChange: (value: number) => void;
};

/** Single-value slider for the few settings that are not per-frame ranges. */
export function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  precision,
  onChange,
}: SliderControlProps) {
  const id = useId();
  const digits = precision ?? (step < 1 ? 2 : 0);
  return (
    <div className="range-control">
      <div className="range-head">
        <label htmlFor={id}>{label}</label>
        <output>{format(value, digits, unit)}</output>
      </div>
      <div className="range-track single">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </div>
  );
}
