import { useEffect, useId, useRef, useState } from "react";
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

type NumberEntryProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

/** A commit-on-blur field, so clearing a number while typing does not become zero. */
export function NumberEntry({
  label,
  value,
  min,
  max,
  step,
  precision,
  disabled = false,
  onChange,
}: NumberEntryProps) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value.toFixed(precision));

  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(value.toFixed(precision));
  }, [precision, value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(value.toFixed(precision));
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    onChange(next);
    setDraft(next.toFixed(precision));
  };

  return (
    <input
      ref={input}
      className="number-entry"
      type="number"
      inputMode="decimal"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value.toFixed(precision));
          event.currentTarget.blur();
        }
      }}
    />
  );
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
        <div className="range-values">
          <NumberEntry
            label={`${label} minimum value`}
            value={low}
            min={min}
            max={high}
            step={step}
            precision={digits}
            onChange={(next) => onChange({ min: Math.min(next, high), max: high })}
          />
          <span aria-hidden="true">–</span>
          <NumberEntry
            label={`${label} maximum value`}
            value={high}
            min={low}
            max={max}
            step={step}
            precision={digits}
            onChange={(next) => onChange({ min: low, max: Math.max(next, low) })}
          />
          {unit && <span>{unit}</span>}
        </div>
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
        <div className="range-values">
          <NumberEntry
            label={`${label} value`}
            value={value}
            min={min}
            max={max}
            step={step}
            precision={digits}
            onChange={onChange}
          />
          {unit && <span>{unit}</span>}
        </div>
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
