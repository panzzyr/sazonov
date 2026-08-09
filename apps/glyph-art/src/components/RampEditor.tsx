import { useEffect, useRef, useState } from "react";
import type { GlyphLibrary, MeasuredGlyph } from "../engine/glyphLibrary";
import { poolCorrection, type SolvedBand } from "../engine/ramp";
import type { Settings } from "../types";

const wellPixels = 96;

type WellProps = {
  glyph: MeasuredGlyph | undefined;
  /** Size relative to a cell, which is what the well represents. */
  size: number;
  inverted: boolean;
};

/**
 * A band's mark, drawn at its actual size relative to the cell.
 *
 * This is the point of the whole strip: read the wells left to right and you
 * see the ramp grow, which is a picture of the tone curve rather than a column
 * of numbers.
 *
 * The colours are literal rather than themed, for two reasons: a canvas cannot
 * resolve `var(--ink)` — it would silently keep painting the default black —
 * and the well is a preview of the printed result, which never follows the
 * interface theme.
 */
function Well({ glyph, size, inverted }: WellProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, wellPixels, wellPixels);
    if (!glyph || glyph.density <= 0 || size <= 0) return;

    const long = Math.min(size, 1.6) * wellPixels;
    const width = glyph.aspect >= 1 ? long : long * glyph.aspect;
    const height = glyph.aspect >= 1 ? long / glyph.aspect : long;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      glyph.bitmap,
      (wellPixels - width) / 2,
      (wellPixels - height) / 2,
      width,
      height,
    );
    context.globalCompositeOperation = "source-in";
    context.fillStyle = inverted ? "#ffffff" : "#000000";
    context.fillRect(0, 0, wellPixels, wellPixels);
    context.globalCompositeOperation = "source-over";
  }, [glyph, size, inverted]);

  return <canvas ref={canvas} width={wellPixels} height={wellPixels} aria-hidden="true" />;
}

export type RampEditorProps = {
  settings: Settings;
  ramp: SolvedBand[];
  library: GlyphLibrary;
  /** Bumped whenever a mark finishes loading, so the wells redraw. */
  libraryVersion: number;
  selectedBand: number;
  playhead: number;
  onSelect: (index: number) => void;
  onSizeChange: (index: number, size: number | null) => void;
  onAddFiles: (files: FileList | File[], bandIndex: number) => void;
  onRemove: (index: number, glyphId: string) => void;
  onRebalance: () => void;
};

export function RampEditor({
  settings,
  ramp,
  library,
  libraryVersion,
  selectedBand,
  playhead,
  onSelect,
  onSizeChange,
  onAddFiles,
  onRemove,
  onRebalance,
}: RampEditorProps) {
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const anyManual = settings.bands.some((band) => band.size !== null);

  return (
    <section className="ramp" aria-label="Tone ramp">
      <header className="ramp-head">
        <h2>tone ramp</h2>
        <span className="ramp-legend" aria-hidden="true">
          <span>paper</span>
          <span className="ramp-gradient" />
          <span>ink</span>
        </span>
        <button type="button" onClick={onRebalance} disabled={!anyManual}>
          rebalance
        </button>
      </header>

      <div className="ramp-columns">
        {settings.bands.map((band, index) => {
          const solved = ramp[index];
          const pool = band.glyphs
            .map((id) => library.get(id))
            .filter((glyph): glyph is MeasuredGlyph => Boolean(glyph));
          const shown = pool.length > 1
            ? pool[Math.floor(playhead / Math.max(1, settings.hold)) % pool.length]
            : pool[0];
          // The well shows the mark at the size it will actually print, which
          // for a cycling band means its density-corrected size, not the
          // band's nominal one.
          const shownSize = shown && pool[0]
            ? solved.size * poolCorrection(pool[0].density, shown.density)
            : solved.size;

          const classes = ["ramp-column"];
          if (index === selectedBand) classes.push("selected");
          if (index === dropTarget) classes.push("dropping");

          return (
            <div
              key={index}
              className={classes.join(" ")}
              onDragOver={(event) => {
                event.preventDefault();
                setDropTarget(index);
              }}
              onDragLeave={() => setDropTarget((current) => (current === index ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setDropTarget(null);
                if (event.dataTransfer.files.length) onAddFiles(event.dataTransfer.files, index);
              }}
            >
              <button
                type="button"
                className="ramp-well"
                style={{ background: settings.invert ? "#000000" : "#ffffff" }}
                aria-label={`Band ${index}, ${pool.length} mark${pool.length === 1 ? "" : "s"}`}
                aria-pressed={index === selectedBand}
                onClick={() => onSelect(index)}
              >
                {pool.length === 0
                  ? <span className="ramp-paper">paper</span>
                  : <Well key={libraryVersion} glyph={shown} size={shownSize} inverted={settings.invert} />}
                {pool.length > 1 && <span className="ramp-badge">×{pool.length}</span>}
                {solved.clamped && (
                  <span className="ramp-warning" title="This mark is too sparse to reach the band's tone.">!</span>
                )}
              </button>

              <p className="ramp-readout">
                <span>{index}</span>
                <span>{pool.length === 0 ? "—" : `${Math.round(solved.size * 100)}%`}</span>
                {solved.manual && <span className="ramp-manual" title="Set by hand">·</span>}
              </p>

              <input
                type="range"
                min={5}
                max={200}
                step={1}
                value={Math.round(solved.size * 100)}
                disabled={pool.length === 0}
                aria-label={`Band ${index} size`}
                onChange={(event) => onSizeChange(index, Number(event.target.value) / 100)}
              />

              <div className="ramp-chips">
                {band.glyphs.map((id, position) => (
                  <button
                    key={`${id}-${position}`}
                    type="button"
                    className="ramp-chip"
                    title={`Remove ${library.get(id)?.spec.label ?? id}`}
                    onClick={() => onRemove(index, id)}
                  >
                    {library.get(id)?.spec.label ?? "?"}
                  </button>
                ))}
                <label className="ramp-add">
                  +
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    multiple
                    onChange={(event) => {
                      if (event.target.files?.length) onAddFiles(event.target.files, index);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
