/**
 * Loads library textures as <img> elements and keeps them alive for reuse.
 *
 * Images are deliberately loaded through the element rather than fetch(): the
 * app ships `connect-src 'none'`, so fetch would be blocked, while `img-src
 * 'self'` permits same-origin element loads. Nothing leaves the machine either
 * way — these are files served from the app's own origin.
 */

import { textureById } from "../generatedTextures";

const base = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

export class TextureCache {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly pending = new Map<string, Promise<HTMLImageElement | null>>();
  private readonly failed = new Set<string>();

  /** A decoded image, or null when it is not loaded yet or failed to load. */
  get(id: string) {
    return this.images.get(id) ?? null;
  }

  has(id: string) {
    return this.images.has(id);
  }

  load(id: string): Promise<HTMLImageElement | null> {
    const loaded = this.images.get(id);
    if (loaded) return Promise.resolve(loaded);
    if (this.failed.has(id)) return Promise.resolve(null);
    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight;

    const entry = textureById.get(id);
    if (!entry) {
      this.failed.add(id);
      return Promise.resolve(null);
    }

    const promise = new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        this.images.set(id, image);
        this.pending.delete(id);
        resolve(image);
      };
      image.onerror = () => {
        this.failed.add(id);
        this.pending.delete(id);
        resolve(null);
      };
      image.src = `${base}textures/${entry.file}`;
    });
    this.pending.set(id, promise);
    return promise;
  }

  /** Resolves once every requested texture has loaded or definitively failed. */
  async preload(ids: Iterable<string>) {
    const unique = [...new Set(ids)];
    const results = await Promise.all(unique.map((id) => this.load(id)));
    return results.filter((image): image is HTMLImageElement => image !== null).length;
  }

  /** Ids that are requested but not yet decoded. */
  missing(ids: Iterable<string>) {
    return [...new Set(ids)].filter((id) => !this.images.has(id) && !this.failed.has(id));
  }
}
