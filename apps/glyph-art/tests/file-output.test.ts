import { describe, expect, it, vi } from "vitest";
import { FileOutput, type ExportDirectory, type WritableFile } from "../src/export/fileOutput";
import { ZipParts } from "../src/export/zipParts";
import { strFromU8, unzipSync } from "fflate";

function writable() {
  const chunks: Uint8Array[] = [];
  const stream: WritableFile = { write: vi.fn(async (chunk) => { chunks.push(chunk instanceof Uint8Array ? chunk : chunk.data); }),
    close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  return { stream, chunks };
}

describe("local disk output", () => {
  it("owns mutable bytes and preserves ordered positional patches", async () => {
    const { stream } = writable(); const output = new FileOutput(stream);
    const data = new Uint8Array([1, 2]); output.write(data); data[0] = 9;
    output.write(new Uint8Array([3]), 0);
    expect(output.pendingBytes).toBe(3);
    await output.close();
    expect(stream.write).toHaveBeenNthCalledWith(1, new Uint8Array([1, 2]));
    expect(stream.write).toHaveBeenNthCalledWith(2, { type: "write", position: 0, data: new Uint8Array([3]) });
    expect(output.pendingBytes).toBe(0); expect(stream.close).toHaveBeenCalledOnce();
    expect(() => output.write(data)).toThrow("closed");
  });
  it.each([new Error("Disk full"), undefined, false])("surfaces disk failures, even empty rejection reasons (%s)", async (reason) => {
    const { stream } = writable(); vi.mocked(stream.write).mockRejectedValue(reason);
    const output = new FileOutput(stream); output.write(new Uint8Array([1])); output.write(new Uint8Array([2]));
    await expect(output.flush()).rejects.toThrow();
    expect(stream.write).toHaveBeenCalledOnce(); expect(output.pendingBytes).toBe(0);
    await output.abort(); expect(stream.abort).toHaveBeenCalledOnce(); expect(stream.close).not.toHaveBeenCalled();
  });
  it("cancels queued writes without publishing an unfinished file", async () => {
    const { stream } = writable(); const output = new FileOutput(stream);
    output.write(new Uint8Array([1])); await output.abort();
    expect(stream.write).not.toHaveBeenCalled(); expect(stream.abort).toHaveBeenCalledOnce();
  });
});

describe("bounded PNG archives", () => {
  it.each([{ bytes: 6, files: 99 }, { bytes: 999, files: 2 }])("splits at byte or file budgets without skipping files (%s)", async limits => {
    const archives: { name: string; files: ReturnType<typeof unzipSync> }[] = [];
    const zip = new ZipParts({ basename: "clip", readme: n => `part ${n}`, limits,
      onArchive: async (blob, name) => { archives.push({ name, files: unzipSync(new Uint8Array(await blob.arrayBuffer())) }); } });
    for (let index = 900; index < 905; index++) await zip.add(`clip-${index}.png`, new Uint8Array([index % 256, 2, 3]));
    await zip.finish();
    expect(zip.parts).toBe(3);
    expect(archives.map(archive => archive.name)).toEqual(["clip-part0001.zip", "clip-part0002.zip", "clip-part0003.zip"]);
    expect(archives.flatMap(archive => Object.keys(archive.files).filter(name => name.endsWith(".png"))))
      .toEqual([900, 901, 902, 903, 904].map(index => `clip-${index}.png`));
    archives.forEach((archive, index) => expect(strFromU8(archive.files["README.txt"])).toBe(`part ${index + 1}`));
  });
  it("streams ZIP bytes to disk and never replaces an existing archive", async () => {
    const { stream, chunks } = writable();
    const getFileHandle = vi.fn(async (_name: string, options: { create: boolean }) => {
      if (!options.create) throw new DOMException("Missing", "NotFoundError");
      return { createWritable: async () => stream };
    });
    const onArchive = vi.fn(); const directory: ExportDirectory = { getFileHandle };
    const zip = new ZipParts({ basename: "clip", directory, readme: () => "metadata", onArchive });
    await zip.add("clip-0900.png", new Uint8Array([1, 2, 3])); await zip.finish();
    const merged = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0; for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    expect(unzipSync(merged)["clip-0900.png"]).toEqual(new Uint8Array([1, 2, 3]));
    expect(onArchive).not.toHaveBeenCalled(); expect(stream.close).toHaveBeenCalledOnce();
    getFileHandle.mockImplementation(async () => ({ createWritable: async () => stream }));
    const collision = new ZipParts({ basename: "clip", directory, readme: () => "", onArchive });
    await expect(collision.add("x.png", new Uint8Array([1]))).rejects.toThrow("already exists");
    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(getFileHandle).toHaveBeenLastCalledWith("clip-part0001.zip", { create: false });
  });
  it("keeps completed parts while discarding a cancelled current part", async () => {
    const onArchive = vi.fn();
    const zip = new ZipParts({ basename: "clip", readme: () => "", onArchive, limits: { bytes: 99, files: 1 } });
    await zip.add("0.png", new Uint8Array([0])); await zip.add("1.png", new Uint8Array([1])); await zip.abort();
    expect(onArchive).toHaveBeenCalledOnce(); expect(onArchive.mock.calls[0][1]).toBe("clip-part0001.zip");
  });
});
