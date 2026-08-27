import { strToU8, zipSync, type Zippable } from "fflate";
import { renderSequence, type SequenceOptions } from "./renderSequence";
import { plateNames } from "../engine/halftone";
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
 * Renders the sequence once per requested pass and packs every frame into a
 * single ZIP. Each pass lands in its own folder so an editor can import them
 * as separate layers.
 */
export async function exportPngSequence(options: PngExportOptions) {
  const { inks: _inks, separations: _separations, basename, onProgress, ...sequence } = options;
  const stem = basename.replace(/\.[^.]+$/, "") || "glyph-art";
  const passes = passesFor(options);
  const files: Zippable = {};

  let completed = 0;
  let total = 0;

  for (const pass of passes) {
    for await (const frame of renderSequence({ ...sequence, ink: pass.ink, plate: pass.plate })) {
      total = frame.total * passes.length;
      const blob = await canvasBlob(frame.canvas);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const name = `${stem}-${String(frame.index).padStart(4, "0")}.png`;
      files[passes.length > 1 ? `${pass.folder}/${name}` : name] = [bytes, { level: 0 }];
      completed += 1;
      onProgress(completed, total);
      // Yield to the event loop so the progress bar and cancel button stay live.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const { settings } = options;
  const description = settings.mode === "halftone"
    ? [
      `screen: ${settings.halftone.lines} lines across at ${settings.halftone.angle}°`,
      `dot: ${settings.halftone.shape}`,
      `separation: ${settings.halftone.separation}`,
    ]
    : [
      `grid: ${settings.grid} cells across`,
      `bands: ${settings.bands.length}`,
      `seed: ${settings.seed}`,
    ];
  const readme = [
    `${stem} — glyph art PNG sequence`,
    "",
    `frames per pass: ${total / passes.length}`,
    `frame rate: ${settings.targetFps} fps`,
    ...description,
    "",
    "passes:",
    ...passes.map((pass) => `  ${pass.folder} — ${pass.note}`),
    "",
    "Import as an image sequence at the frame rate above.",
    "",
  ].join("\n");
  files["README.txt"] = strToU8(readme);

  return new Blob([zipSync(files, { level: 6 })], { type: "application/zip" });
}
