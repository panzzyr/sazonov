type RangeControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
};

export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
  format = (current) => String(current),
}: RangeControlProps) {
  return (
    <label className="range-control" onClick={(event) => {
      if (event.altKey) {
        event.preventDefault();
        onChange(defaultValue);
      }
    }}>
      <span>{label}</span>
      <output>{format(value)}</output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
    </label>
  );
}
