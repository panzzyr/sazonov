import { strToU8, zipSync, type Zippable } from "fflate";
import { renderSequence, type SequenceOptions } from "./renderSequence";
import type { ExportInk } from "../types";

const inkNotes: Record<ExportInk, string> = {
  flat: "Opaque grayscale.",
  white: "White ink on transparency; black was treated as alpha.",
  black: "Black ink on transparency; white was treated as alpha.",
};

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode this frame as PNG."));
    }, "image/png");
  });
}

export type PngExportOptions = Omit<SequenceOptions, "ink"> & {
  /** One ZIP may carry several ink passes of the same sequence. */
  inks: ExportInk[];
  basename: string;
  onProgress: (completed: number, total: number) => void;
};

/**
 * Renders the sequence once per requested ink pass and packs every frame into
 * a single ZIP. Each pass lands in its own folder so an editor can import them
 * as separate layers.
 */
export async function exportPngSequence(options: PngExportOptions) {
  const { inks, basename, onProgress, ...sequence } = options;
  const stem = basename.replace(/\.[^.]+$/, "") || "printor";
  const passes = inks.length ? inks : (["flat"] as ExportInk[]);
  const files: Zippable = {};

  let completed = 0;
  let total = 0;

  for (const ink of passes) {
    for await (const frame of renderSequence({ ...sequence, ink })) {
      total = frame.total * passes.length;
      const blob = await canvasBlob(frame.canvas);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const name = `${stem}-${String(frame.index).padStart(4, "0")}.png`;
      files[passes.length > 1 ? `${ink}/${name}` : name] = [bytes, { level: 0 }];
      completed += 1;
      onProgress(completed, total);
      // Yield to the event loop so the progress bar and cancel button stay live.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const readme = [
    `${stem} — printor PNG sequence`,
    "",
    `frames per pass: ${total / passes.length}`,
    `frame rate: ${options.settings.targetFps} fps`,
    `seed: ${options.settings.seed}`,
    "",
    "passes:",
    ...passes.map((ink) => `  ${ink} — ${inkNotes[ink]}`),
    "",
    "Import as an image sequence at the frame rate above.",
    "",
  ].join("\n");
  files["README.txt"] = strToU8(readme);

  return new Blob([zipSync(files, { level: 6 })], { type: "application/zip" });
}
