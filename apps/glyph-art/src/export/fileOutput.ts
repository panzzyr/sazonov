/** Local browser files only. Pickers are invoked by the export click, before encoding awaits. */
export type WritableFile = {
  write: (chunk: Uint8Array | { type: "write"; position: number; data: Uint8Array }) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};
export type ExportDirectory = {
  getFileHandle: (name: string, options: { create: boolean }) => Promise<{ createWritable: () => Promise<WritableFile> }>;
};
type Pickers = {
  showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<WritableFile> }>;
  showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<ExportDirectory>;
};
const pickers = () => globalThis as unknown as Pickers;
export const canSaveFile = () => typeof pickers().showSaveFilePicker === "function";
export const canSaveDirectory = () => typeof pickers().showDirectoryPicker === "function";

export async function pickVideoFile(name: string) {
  const handle = await pickers().showSaveFilePicker!({ suggestedName: name,
    types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
  return new FileOutput(await handle.createWritable());
}
export function pickExportDirectory() { return pickers().showDirectoryPicker!({ mode: "readwrite" }); }

/** Ordered writes with explicit backpressure and surfaced disk errors. */
export class FileOutput {
  private queue: Promise<void> = Promise.resolve();
  private failure: unknown;
  pendingBytes = 0;
  private stopped = false;

  constructor(private stream: WritableFile) {}

  write(data: Uint8Array, position?: number) {
    if (this.stopped) throw new Error("The export file is closed.");
    const owned = data.slice();
    this.pendingBytes += owned.byteLength;
    this.queue = this.queue.then(async () => {
      if (this.failure || this.stopped) return;
      await this.stream.write(position === undefined ? owned : { type: "write", position, data: owned });
    }).catch((error: unknown) => { this.failure = error instanceof Error ? error : new Error(String(error ?? "The export disk write failed.")); }).finally(() => {
      this.pendingBytes -= owned.byteLength;
    });
  }

  async flush() {
    await this.queue;
    if (this.failure) throw this.failure;
  }

  async close() {
    await this.flush();
    await this.stream.close();
    this.stopped = true;
  }

  async abort() {
    this.stopped = true;
    await this.queue;
    await this.stream.abort();
  }
}
