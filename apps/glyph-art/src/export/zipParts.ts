import { strToU8, Zip, ZipPassThrough } from "fflate";
import { FileOutput, type ExportDirectory } from "./fileOutput";

export const zipPartBytes = 128 * 1024 * 1024;
export const zipPartFiles = 2000;

/** Bounded ZIP32 archives; even a disk export never risks ZIP32 size/entry overflow. */
export class ZipParts {
  parts = 0;
  private zip: Zip | null = null;
  private output: FileOutput | null = null;
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private bytes = 0;
  private files = 0;
  private failure: Error | null = null;

  constructor(private options: {
    basename: string;
    directory?: ExportDirectory;
    onArchive: (blob: Blob, name: string) => void | Promise<void>;
    readme: (part: number) => string;
    /** Injectable small budgets for tests; production uses the constants above. */
    limits?: { bytes: number; files: number };
  }) {}

  private name() { return `${this.options.basename}-part${String(this.parts).padStart(4, "0")}.zip`; }

  private async start() {
    this.parts++;
    this.bytes = this.files = 0;
    this.chunks = [];
    if (this.options.directory) {
      // Folder selection does not authorize silently overwriting old exports.
      let exists = false;
      try {
        await this.options.directory.getFileHandle(this.name(), { create: false });
        exists = true;
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
      }
      if (exists) throw new Error(`${this.name()} already exists. Choose an empty export folder to keep the previous files.`);
      const handle = await this.options.directory.getFileHandle(this.name(), { create: true });
      this.output = new FileOutput(await handle.createWritable());
    }
    this.zip = new Zip((error, chunk) => {
      if (error) { this.failure = error; return; }
      if (this.output) this.output.write(chunk);
      else this.chunks.push(chunk);
    });
  }

  private push(name: string, bytes: Uint8Array) {
    const entry = new ZipPassThrough(name);
    this.zip!.add(entry);
    entry.push(bytes, true); // PNG is already compressed; retain its exact bytes.
  }

  async add(name: string, bytes: Uint8Array) {
    const limits = this.options.limits ?? { bytes: zipPartBytes, files: zipPartFiles };
    if (this.zip && this.files > 0 && (this.bytes + bytes.byteLength > limits.bytes || this.files >= limits.files)) {
      await this.finish();
    }
    if (!this.zip) await this.start();
    this.push(name, bytes);
    this.bytes += bytes.byteLength;
    this.files++;
    await this.output?.flush();
    if (this.failure) throw this.failure;
  }

  async finish() {
    if (!this.zip) return;
    this.push("README.txt", strToU8(this.options.readme(this.parts)));
    this.zip.end();
    if (this.failure) throw this.failure;
    if (this.output) await this.output.close();
    else {
      const blob = new Blob(this.chunks, { type: "application/zip" });
      this.chunks = [];
      await this.options.onArchive(blob, this.name());
    }
    this.zip = null;
    this.output = null;
  }

  async abort() {
    this.zip?.terminate();
    this.zip = null;
    this.chunks = [];
    await this.output?.abort();
    this.output = null;
  }
}
