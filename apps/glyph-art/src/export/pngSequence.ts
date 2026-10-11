import { frameCount, normalizeFrameRange, renderSequence, sequenceSize, type SequenceOptions } from "./renderSequence";
import { ZipParts } from "./zipParts";
import type { ExportDirectory } from "./fileOutput";
import { plateNames } from "../engine/halftone";
import { isScatterLoop } from "../engine/symbolMotion";
import type { ExportInk } from "../types";

const inkNotes: Record<ExportInk, string> = {
  flat: "Opaque: marks over paper.",
  ink: "The marks only; the paper is transparent.",
  paper: "The paper only; the marks are punched out of it.",
};

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode this frame as PNG."));
    }, "image/png");
  });
}

export type PngExportOptions = Omit<SequenceOptions, "ink" | "plate"> & {
  /** One ZIP may carry several passes of the same sequence. */
  inks: ExportInk[];
  /** Halftone only: also write each separation on its own, as a plate. */
  separations: boolean;
  basename: string;
  onProgress: (completed: number, total: number) => void;
  directory?: ExportDirectory;
  onArchive: (blob: Blob, name: string) => void | Promise<void>;
};

type Pass = { folder: string; note: string; ink: ExportInk; plate?: number };

/**
 * The passes one ZIP carries.
 *
 * A separation is not another way of colouring the same frame, it is a
 * different frame: the plate alone, black on white, which is what a printer
 * loads. So it is its own pass rather than another `ExportInk`.
 */
function passesFor(options: PngExportOptions): Pass[] {
  const inks = options.inks.length ? options.inks : (["flat"] as ExportInk[]);
  const passes: Pass[] = inks.map((ink) => ({ folder: ink, note: inkNotes[ink], ink }));

  if (options.settings.mode === "halftone" && options.separations) {
    plateNames(options.settings.halftone).forEach((name, plate) => {
      passes.push({
        folder: `plate-${name}`,
        note: `The ${name} separation alone, black on white.`,
        ink: "flat",
        plate,
      });
    });
  }
  return passes;
}

/**
 * Incremental ZIP parts. No retained full sequence; absolute frame names allow
 * parts to be merged without restarting scatter, appearance or grid keyframes.
 */
export async function exportPngSequence(options: PngExportOptions) {
  const { inks: _inks, separations: _separations, basename, onProgress, directory, onArchive, ...sequence } = options;
  const stem = basename.replace(/\.[^.]+$/, "").replaceAll(/[\\/]/g, "_") || "glyph-art";
  const passes = passesFor(options);
  const fullTotal = frameCount(options.source, options.settings);
  const range = normalizeFrameRange(fullTotal, options.range);
  const total = (range.end - range.start) * passes.length;
  const digits = Math.max(4, String(fullTotal - 1).length);

  const { settings } = options;
  const frame = sequenceSize(options.source, settings);
  const description = settings.mode === "halftone"
    ? [
      `screen: ${settings.halftone.lines} lines across at ${settings.halftone.angle}°`,
      `dot: ${settings.halftone.shape}`,
      `separation: ${settings.halftone.separation}`,
    ]
    : [
      `grid: ${settings.grid} cells across`,
      ...(settings.animation.enabled
        ? [
          `grid animation: ${settings.animation.interpolation}`,
          `keyframes: ${settings.animation.keyframes
            .map((keyframe) => `${Math.round(keyframe.at * 100)}%=${keyframe.grid}`)
            .join(", ")}`,
        ]
        : []),
      ...(settings.gradient.enabled ? [
        `spatial step gradient: ${settings.gradient.direction}`,
        `transition width: ${settings.gradient.blend}`,
        `step order: ${settings.gradient.steps.join(" -> ")}`,
        "bands per step: 12",
      ] : [`bands: ${settings.bands.length}`]),
      `seed: ${settings.seed}`,
      `symbol seed: ${settings.glyphSeed}`,
      `symbol motion: ${settings.hold === "infinite" ? "frozen" : settings.symbolMotion.mode}`,
      ...(settings.symbolMotion.mode === "scatter" ? [
        `changes: ${settings.symbolMotion.amount}% on average per ${settings.symbolMotion.interval} ms`,
        `seamless scatter loop: ${isScatterLoop(settings, options.source.kind === "image" ? settings.stillFrames : undefined) ? "yes" : "no"}`,
      ] : [`hold: ${settings.hold} frames`]),
    ];
  const readme = [
    `${stem} — glyph art PNG sequence`,
    "",
    `frames per pass: ${total / passes.length}`,
    `source frame range: ${range.start}..${range.end - 1} (inclusive)`,
    `full timeline frames: ${fullTotal}`,
    `frame rate: ${settings.targetFps} fps`,
    `frame: ${frame.width} × ${frame.height} px`,
    ...description,
    "",
    "passes:",
    ...passes.map((pass) => `  ${pass.folder} — ${pass.note}`),
    "",
    "Import as an image sequence at the frame rate above.",
    "Combine all ZIP parts into one folder. Frame names use full-timeline indices; no frames are skipped.",
    "",
  ].join("\n");
  const archives = new ZipParts({ basename: `${stem}-glyph-art`, directory, onArchive,
    readme: (part) => `${readme}\narchive part: ${part}\n` });
  let completed = 0;
  try {
    for (const pass of passes) {
      for await (const frame of renderSequence({ ...sequence, ink: pass.ink, plate: pass.plate })) {
        const blob = await canvasBlob(frame.canvas);
        options.signal.throwIfAborted();
        const name = `${stem}-${String(frame.index).padStart(digits, "0")}.png`;
        await archives.add(passes.length > 1 ? `${pass.folder}/${name}` : name,
          new Uint8Array(await blob.arrayBuffer()));
        onProgress(++completed, total);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    options.signal.throwIfAborted();
    await archives.finish();
    return archives.parts;
  } catch (error) {
    await archives.abort().catch(() => {});
    throw error;
  }
}
