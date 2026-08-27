import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolShell } from "./shared/Shell";
import { RampEditor } from "./components/RampEditor";
import { RangeControl, SliderControl } from "./components/RangeControl";
import { GlyphLibrary, readFileAsDataUrl } from "./engine/glyphLibrary";
import { GlyphRenderer } from "./engine/render";
import { HalftoneRenderer } from "./engine/halftone";
import { solveRamp } from "./engine/ramp";
import { loopLength } from "./engine/cellParams";
import { autoLevels, gridSize, sampleSource, type ToneField } from "./engine/tone";
import { exportPngSequence } from "./export/pngSequence";
import { canEncodeMp4, exportMp4 } from "./export/mp4";
import {
  downloadBlob,
  frameCount,
  halftoneField,
  sequenceSize,
  MAX_EXPORT_FRAMES,
  type ExportSource,
} from "./export/renderSequence";
import { activePreset, presets } from "./presets";
import { decodeSettings, encodeSettings, hasCustomMarks, parseSettings } from "./projectState";
import { useGlyphArtStore } from "./store";
import {
  cellPixels,
  dotShapes,
  fontStacks,
  halftoneWidths,
  maxBands,
  maxFps,
  maxGain,
  maxGrid,
  maxHold,
  maxLines,
  maxPeak,
  maxSizeCeiling,
  maxSpread,
  maxWeight,
  minBands,
  minFps,
  minGain,
  minGrid,
  minHold,
  minLines,
  minPeak,
  minSizeCeiling,
  minSpread,
  minWeight,
  separations,
  type DotShape,
  type ExportFormat,
  type ExportInk,
  type GlyphSpec,
  type HalftoneSettings,
  type Separation,
} from "./types";

const STORAGE_KEY = "glyph-art-project-v1";

type Media =
  | {
    kind: "video";
    name: string;
    url: string;
    video: HTMLVideoElement;
    width: number;
    height: number;
    duration: number;
  }
  | { kind: "image"; name: string; url: string; bitmap: ImageBitmap; width: number; height: number };

/** Ids only have to be unique within a project, never guessable. */
let glyphSequence = 0;
function nextGlyphId(prefix: string) {
  glyphSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${glyphSequence}`;
}

/**
 * Some containers decode nowhere and fire no error, leaving the drop zone
 * looking broken. A timeout turns that silence into a message.
 */
function metadata(video: HTMLVideoElement, timeoutMs = 15_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("The browser did not decode this video. Try an H.264 MP4."));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not open this video."));
    };
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function seekTo(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = time;
  });
}

export function App() {
  const settings = useGlyphArtStore((state) => state.settings);
  const selectedBand = useGlyphArtStore((state) => state.selectedBand);
  const selectBand = useGlyphArtStore((state) => state.selectBand);
  const setGlobal = useGlyphArtStore((state) => state.setGlobal);
  const setBandCount = useGlyphArtStore((state) => state.setBandCount);
  const usePreset = useGlyphArtStore((state) => state.usePreset);
  const fitRamp = useGlyphArtStore((state) => state.fitRamp);
  const setBandGlyphs = useGlyphArtStore((state) => state.setBandGlyphs);
  const setBandSize = useGlyphArtStore((state) => state.setBandSize);
  const addGlyphs = useGlyphArtStore((state) => state.addGlyphs);
  const rebalanceBands = useGlyphArtStore((state) => state.rebalanceBands);
  const replaceSettings = useGlyphArtStore((state) => state.replaceSettings);
  const reroll = useGlyphArtStore((state) => state.reroll);
  const undo = useGlyphArtStore((state) => state.undo);
  const redo = useGlyphArtStore((state) => state.redo);
  const reset = useGlyphArtStore((state) => state.reset);

  const [media, setMedia] = useState<Media | null>(null);
  const [field, setField] = useState<ToneField | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [peek, setPeek] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ label: string; done: number; total: number } | null>(null);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [inks, setInks] = useState<ExportInk[]>(["flat"]);
  const [markText, setMarkText] = useState("");
  const [markFont, setMarkFont] = useState(fontStacks[0].id);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [separationPlates, setSeparationPlates] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlyphRenderer | null>(null);
  const halftoneRef = useRef<HalftoneRenderer | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const libraryRef = useRef<GlyphLibrary | null>(null);
  const glyphsRef = useRef(settings.glyphs);
  const leveledRef = useRef<Media | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  glyphsRef.current = settings.glyphs;
  if (!scratchRef.current) scratchRef.current = document.createElement("canvas");
  if (!libraryRef.current) libraryRef.current = new GlyphLibrary();
  const library = libraryRef.current;

  const mp4Available = useMemo(() => canEncodeMp4(), []);

  /** Marks are rasterized once; this is what says when that has to happen. */
  const glyphSignature = settings.glyphs
    .map((spec) => `${spec.id}:${spec.kind}:${spec.font ?? ""}:${spec.source.length}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    library.ensure(glyphsRef.current)
      .then(() => {
        if (!cancelled) setLibraryVersion((version) => version + 1);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "A mark could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, [glyphSignature, library]);

  const exportSource = useMemo<ExportSource | null>(() => {
    if (!media) return null;
    return media.kind === "video"
      ? {
        kind: "video",
        video: media.video,
        width: media.width,
        height: media.height,
        duration: media.duration,
      }
      : { kind: "image", bitmap: media.bitmap, width: media.width, height: media.height };
  }, [media]);

  const totalFrames = exportSource ? frameCount(exportSource, settings) : 1;
  const raster = exportSource ? sequenceSize(exportSource, settings) : null;
  const frameWidth = raster?.width ?? 0;
  const frameHeight = raster?.height ?? 0;

  // Restore a shared link first, then whatever was last open on this machine.
  useEffect(() => {
    try {
      const shared = new URLSearchParams(window.location.hash.slice(1)).get("p");
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (shared) replaceSettings(decodeSettings(shared));
      else if (saved) replaceSettings(parseSettings(JSON.parse(saved)));
    } catch {
      // A corrupt link or a project from a future version opens as defaults.
    }
  }, [replaceSettings]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, settings }));
      } catch {
        // Quota or private browsing; the session still works unsaved.
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [settings]);

  // Sampling the source is the only step that reads the raster, so it is kept
  // apart from drawing: a still is sampled once, a video once per frame.
  const videoFrame = media?.kind === "video" ? frame : 0;
  useEffect(() => {
    if (!media) {
      setField(null);
      return;
    }
    let cancelled = false;
    // A halftone dot reads the picture at its own centre, so the field it reads
    // is not the screen and has nothing to do with the ruling; the glyph path's
    // field *is* the cell grid. One sampling step, two very different grids.
    const { gridW, gridH } = settings.mode === "halftone"
      ? halftoneField(settings, media.width, media.height)
      : gridSize(settings.grid, media.width, media.height);

    const run = async () => {
      if (media.kind === "video") {
        await seekTo(media.video, Math.min(media.duration, videoFrame / settings.targetFps));
        if (cancelled) return;
      }
      const source = media.kind === "video" ? media.video : media.bitmap;
      const next = sampleSource(source, media.width, media.height, gridW, gridH, scratchRef.current!);
      if (!cancelled) setField(next);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [media, settings.mode, settings.grid, settings.halftone.width, settings.targetFps, videoFrame]);

  // Auto-levels, once per source. A flat photo quantized into seven bands uses
  // four of them and looks dead; per-frame levels on a video would pump.
  useEffect(() => {
    if (!field || !media || leveledRef.current === media) return;
    leveledRef.current = media;
    setGlobal("levels", autoLevels(field.tone));
  }, [field, media, setGlobal]);

  const ramp = useMemo(
    () => solveRamp(settings, library.metrics),
    // libraryVersion stands in for the measured densities, which live outside
    // React state because the renderer reads them every cell.
    [settings, library, libraryVersion],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !field) return;
    try {
      if (settings.mode === "halftone") {
        if (frameWidth === 0) return;
        if (!halftoneRef.current) halftoneRef.current = new HalftoneRenderer(canvas);
        halftoneRef.current.render({
          settings,
          field,
          ink: "flat",
          frame: { width: frameWidth, height: frameHeight },
        });
        return;
      }
      if (!rendererRef.current) rendererRef.current = new GlyphRenderer(canvas);
      rendererRef.current.render({ settings, field, library, frame, ink: "flat", ramp });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This frame could not be drawn.");
    }
    // `raster` is a fresh object every render, so the frame enters as two
    // numbers; depending on the object would redraw the screen on every
    // keystroke anywhere in the interface.
  }, [field, settings, frame, frameWidth, frameHeight, library, libraryVersion, ramp]);

  useEffect(() => {
    if (frame < totalFrames) return;
    setFrame(Math.max(0, totalFrames - 1));
  }, [frame, totalFrames]);

  useEffect(() => {
    if (!playing || !media || totalFrames < 2) return;
    const interval = window.setInterval(
      () => setFrame((current) => (current + 1) % totalFrames),
      1000 / settings.targetFps,
    );
    return () => window.clearInterval(interval);
  }, [playing, media, totalFrames, settings.targetFps]);

  useEffect(() => () => {
    if (media) URL.revokeObjectURL(media.url);
  }, [media]);

  const openMedia = useCallback(async (file: File) => {
    setMessage(null);
    setPlaying(false);
    setFrame(0);
    const url = URL.createObjectURL(file);
    try {
      if (file.type.startsWith("video/")) {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;
        video.src = url;
        await metadata(video);
        setMedia({
          kind: "video",
          name: file.name,
          url,
          video,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
        });
        return;
      }
      const bitmap = await createImageBitmap(file);
      setMedia({
        kind: "image",
        name: file.name,
        url,
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      setMessage(error instanceof Error ? error.message : "That file could not be opened.");
    }
  }, []);

  const addMarkFiles = useCallback(async (files: FileList | File[], bandIndex?: number) => {
    try {
      const specs: GlyphSpec[] = [];
      for (const file of Array.from(files).slice(0, 24)) {
        if (!file.type.startsWith("image/")) continue;
        specs.push({
          id: nextGlyphId("file"),
          label: file.name.replace(/\.[^.]+$/, "").slice(0, 12) || "mark",
          kind: "file",
          source: await readFileAsDataUrl(file),
        });
      }
      if (specs.length) addGlyphs(specs, bandIndex);
      else setMessage("Marks have to be PNG, JPEG, SVG or WebP.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Those marks could not be read.");
    }
  }, [addGlyphs]);

  const addTextMarks = useCallback(() => {
    const characters = [...markText].filter((character) => character.trim().length > 0);
    if (!characters.length) return;
    addGlyphs(
      characters.map((character) => ({
        id: nextGlyphId("text"),
        label: character,
        kind: "text" as const,
        source: character,
        font: markFont,
      })),
      selectedBand,
    );
    setMarkText("");
  }, [addGlyphs, markFont, markText, selectedBand]);

  const removeFromBand = useCallback((index: number, glyphId: string) => {
    const band = settings.bands[index];
    if (!band) return;
    const position = band.glyphs.indexOf(glyphId);
    if (position < 0) return;
    setBandGlyphs(index, band.glyphs.filter((_, offset) => offset !== position));
  }, [setBandGlyphs, settings.bands]);

  const toggleInk = (ink: ExportInk) => {
    setInks((current) => (current.includes(ink)
      ? current.filter((entry) => entry !== ink)
      : [...current, ink]));
  };

  const runExport = useCallback(async () => {
    if (!exportSource) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPlaying(false);
    setMessage(null);
    setBusy({ label: format === "png" ? "rendering PNG" : "encoding MP4", done: 0, total: totalFrames });

    const stem = (media?.name ?? "glyph-art").replace(/\.[^.]+$/, "");
    const onProgress = (done: number, total: number) => setBusy({
      label: format === "png" ? "rendering PNG" : "encoding MP4",
      done,
      total,
    });

    try {
      if (format === "png") {
        const blob = await exportPngSequence({
          source: exportSource,
          settings,
          library,
          signal: controller.signal,
          inks,
          separations: separationPlates,
          basename: stem,
          onProgress,
        });
        downloadBlob(blob, `${stem}-glyph-art.zip`);
      } else {
        const blob = await exportMp4({
          source: exportSource,
          settings,
          library,
          signal: controller.signal,
          onProgress,
        });
        downloadBlob(blob, `${stem}-glyph-art.mp4`);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage(error instanceof Error ? error.message : "The export failed.");
      }
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }, [exportSource, format, inks, library, media?.name, separationPlates, settings, totalFrames]);

  const copyShareLink = useCallback(() => {
    window.location.hash = `p=${encodeSettings(settings)}`;
    setMessage(hasCustomMarks(settings)
      ? "Link copied to the address bar. Uploaded marks are not in it — save the project file to keep those."
      : "Link copied to the address bar.");
  }, [settings]);

  const saveProject = useCallback(() => {
    const blob = new Blob([JSON.stringify({ version: 1, settings }, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, "glyph-art-project.json");
  }, [settings]);

  const loadProject = useCallback(async (file: File) => {
    try {
      replaceSettings(parseSettings(JSON.parse(await file.text())));
      setMessage(null);
    } catch {
      setMessage("That file is not a glyph art project.");
    }
  }, [replaceSettings]);

  useEffect(() => {
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLElement
      && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

    const onKeyDown = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if (event.key === "\\") {
        setPeek(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((current) => !current);
        return;
      }
      if (event.key === "ArrowLeft") setFrame((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setFrame((current) => Math.min(totalFrames - 1, current + 1));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "\\") setPeek(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [redo, totalFrames, undo]);

  const cell = cellPixels(settings.grid);
  const seamless = loopLength(settings.bands.map((band) => band.glyphs.length), settings.hold);
  const cycling = settings.bands.some((band) => band.glyphs.length > 1);
  const halftoning = settings.mode === "halftone";
  const halftone = settings.halftone;
  const preset = activePreset(settings);

  const setHalftone = <Key extends keyof HalftoneSettings>(
    key: Key,
    value: HalftoneSettings[Key],
  ) => setGlobal("halftone", { ...halftone, [key]: value }, `halftone.${String(key)}`);

  return (
    <ToolShell name="glyph art">
      <div className="workspace">
        <aside className="panel panel-left" aria-label="Source and grid">
          <section className="panel-block">
            <h2>mode</h2>
            <div className="toggle-row">
              <button
                type="button"
                aria-pressed={!halftoning}
                onClick={() => setGlobal("mode", "glyph")}
              >
                glyphs
              </button>
              <button
                type="button"
                aria-pressed={halftoning}
                onClick={() => setGlobal("mode", "halftone")}
              >
                halftone
              </button>
            </div>
            <p className="control-hint">
              {halftoning
                ? "A rotated screen of dots. Tone is the area of a dot, so there are no cells, "
                  + "no marks and no ramp — the controls below are a press, not a grid."
                : "One mark per cell, where the size of the mark carries the tone."}
            </p>
          </section>

          <section className="panel-block">
            <h2>source</h2>
            {/* Not image/*: an SVG source cannot be relied on to decode through
                createImageBitmap, and marks are the place for vector anyway. */}
            <label className="drop">
              <input
                type="file"
                accept="video/*,image/png,image/jpeg,image/webp,image/gif,image/avif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void openMedia(file);
                  event.target.value = "";
                }}
              />
              <span>{media ? "replace" : "drop an image or a video"}</span>
            </label>
            {media && (
              <p className="control-hint">
                {media.name} · {media.width}×{media.height}
                {media.kind === "video" && ` · ${media.duration.toFixed(1)}s`}
              </p>
            )}
          </section>

          {!halftoning && (
            <section className="panel-block">
              <h2>presets</h2>
              <div className="preset-grid">
                {presets.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={preset?.id === entry.id}
                    onClick={() => usePreset(entry)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <p className="control-hint">
                Each set is scanned type and marks of its period, sorted onto twelve levels:
                every level prints at least two of them, and the darkest four. A mark serves
                two or three levels at different sizes, so a level is a texture rather than a
                repeated stamp. Only the marks change — the grid, the levels and the
                inversions stay where you put them.
              </p>
            </section>
          )}

          {!halftoning && (
          <section className="panel-block">
            <h2>grid</h2>
            <SliderControl
              label="cells"
              value={settings.grid}
              min={minGrid}
              max={maxGrid}
              onChange={(value) => setGlobal("grid", Math.round(value))}
            />
            <SliderControl
              label="hand"
              value={settings.hand}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setGlobal("hand", value)}
            />
            <p className="control-hint">
              hand adds seeded rotation, offset and size jitter per cell — the same every
              frame, so the surface loosens without boiling.
              {cell < 8 && " At this many cells the marks are smaller than 8px and stop reading as marks."}
            </p>
          </section>
          )}

          <section className="panel-block">
            <h2>tone</h2>
            <RangeControl
              label="levels"
              value={settings.levels}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => setGlobal("levels", value)}
            />
            {halftoning ? (
              <>
                <SliderControl
                  label="gain"
                  value={halftone.gain}
                  min={minGain}
                  max={maxGain}
                  step={0.05}
                  onChange={(value) => setHalftone("gain", value)}
                />
                <SliderControl
                  label="spread"
                  value={halftone.spread}
                  min={minSpread}
                  max={maxSpread}
                  step={0.01}
                  onChange={(value) => setHalftone("spread", value)}
                />
                <p className="control-hint">
                  gain bends tone into dot area — under 1 opens the shadows, over 1 holds them
                  back. spread is the press: every dot is scaled before it prints, so over 1 is
                  ink bleeding into the paper and under 1 is a starved screen.
                </p>
              </>
            ) : (
              <>
                <SliderControl
                  label="bands"
                  value={settings.bands.length}
                  min={minBands}
                  max={maxBands}
                  onChange={(value) => setBandCount(value)}
                />
                <SliderControl
                  label="weight"
                  value={settings.weight}
                  min={minWeight}
                  max={maxWeight}
                  step={0.05}
                  onChange={(value) => setGlobal("weight", value)}
                />
                <SliderControl
                  label="max ink"
                  value={settings.peak}
                  min={minPeak}
                  max={maxPeak}
                  step={0.01}
                  onChange={(value) => setGlobal("peak", value)}
                />
                <SliderControl
                  label="max mark"
                  value={settings.maxSize}
                  min={minSizeCeiling}
                  max={maxSizeCeiling}
                  step={0.01}
                  onChange={(value) => setGlobal("maxSize", value)}
                />
                <div className="button-row">
                  <button type="button" onClick={() => fitRamp(library.metrics)}>fit ramp</button>
                </div>
                <p className="control-hint">
                  weight bends the whole ramp. max ink is what the darkest level asks for, and
                  max mark is how far a mark may spill past its cell — nothing is ever clipped,
                  but past about 1.2 the marks knit into a mass instead of staying countable.
                  fit ramp solves max ink so the darkest level lands exactly on max mark, which
                  is how a set of your own marks gets a full ramp.
                </p>
              </>
            )}
          </section>

          {halftoning && (
            <section className="panel-block">
              <h2>screen</h2>
              <SliderControl
                label="lines"
                value={halftone.lines}
                min={minLines}
                max={maxLines}
                onChange={(value) => setHalftone("lines", Math.round(value))}
              />
              <SliderControl
                label="angle"
                value={halftone.angle}
                min={0}
                max={90}
                unit="°"
                onChange={(value) => setHalftone("angle", Math.round(value))}
              />
              <div className="field">
                <label htmlFor="dot-shape">dot</label>
                <select
                  id="dot-shape"
                  value={halftone.shape}
                  onChange={(event) => setHalftone("shape", event.target.value as DotShape)}
                >
                  {dotShapes.map((shape) => (
                    <option key={shape} value={shape}>{shape}</option>
                  ))}
                </select>
              </div>
              <p className="control-hint">
                lines is the ruling across the frame — {halftone.lines} of them across{" "}
                {halftone.width}px is a {(halftone.width / halftone.lines).toFixed(0)}px dot.
                Every shape is solved from the same ink area, so changing it changes the
                texture of the print and not its tone.
              </p>
            </section>
          )}

          {halftoning && (
            <section className="panel-block">
              <h2>separation</h2>
              <div className="toggle-row">
                {separations.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    aria-pressed={halftone.separation === entry}
                    onClick={() => setHalftone("separation", entry as Separation)}
                  >
                    {entry}
                  </button>
                ))}
              </div>
              {halftone.separation === "cmyk" && (
                <SliderControl
                  label="black"
                  value={halftone.blackGeneration}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(value) => setHalftone("blackGeneration", value)}
                />
              )}
              {halftone.separation === "duotone" && (
                <div className="field">
                  <label htmlFor="ink-one">inks</label>
                  <input
                    id="ink-one"
                    type="color"
                    value={halftone.inks[0]}
                    aria-label="First duotone ink"
                    onChange={(event) => setHalftone("inks", [event.target.value, halftone.inks[1]])}
                  />
                  <input
                    type="color"
                    value={halftone.inks[1]}
                    aria-label="Second duotone ink"
                    onChange={(event) => setHalftone("inks", [halftone.inks[0], event.target.value])}
                  />
                </div>
              )}
              <p className="control-hint">
                {halftone.separation === "cmyk"
                  ? "Four plates at 15°, 75°, 0° and 45°, multiplied like wet ink. black is grey "
                    + "component replacement: at 0 the neutrals are built from cyan, magenta and "
                    + "yellow together; at 1 black carries them alone, the way newsprint does."
                  : halftone.separation === "duotone"
                    ? "Two screens 30° apart. The second ink is held out of the highlights, so the "
                      + "pair reads as two inks rather than as one ink printed twice."
                    : "One screen. The angle is the only thing standing between it and the frame, "
                      + "which is why 45° is the default: a dot grid disappears there."}
              </p>
            </section>
          )}

          {!halftoning && (
          <section className="panel-block">
            <h2>marks</h2>
            <div className="field">
              <input
                type="text"
                value={markText}
                maxLength={24}
                placeholder="type characters"
                aria-label="Characters to add as marks"
                onChange={(event) => setMarkText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addTextMarks();
                }}
              />
              <select
                value={markFont}
                aria-label="Font for typed marks"
                onChange={(event) => setMarkFont(event.target.value)}
              >
                {fontStacks.map((font) => (
                  <option key={font.id} value={font.id}>{font.label}</option>
                ))}
              </select>
              <button type="button" onClick={addTextMarks} disabled={!markText.trim()}>add</button>
            </div>
            <div className="button-row">
              <label className="button-like">
                load a set
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  multiple
                  onChange={(event) => {
                    if (event.target.files?.length) void addMarkFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="control-hint">
              Each typed character becomes one mark on band {selectedBand}. A whole set of
              image files spreads across the bands in file order; dropping files on a single
              band in the ramp below adds them all to that band, where they cycle.
            </p>
          </section>
          )}
        </aside>

        <main
          className="stage"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void openMedia(file);
          }}
        >
          <div className="canvas-stage">
            {media && peek && (media.kind === "image"
              ? <img className="peek" src={media.url} alt="" />
              : <video className="peek" src={media.url} muted playsInline />)}
            {/* Kept mounted so the renderer's canvas reference never changes. */}
            <canvas ref={canvasRef} className="output" hidden={!media || peek} />
            {!media && <p className="stage-empty">Drop an image or a video anywhere here.</p>}
          </div>

          <div className="transport">
            <button type="button" onClick={() => setPlaying((current) => !current)} disabled={totalFrames < 2}>
              {playing ? "pause" : "play"}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, totalFrames - 1)}
              value={Math.min(frame, totalFrames - 1)}
              aria-label="Frame"
              disabled={totalFrames < 2}
              onChange={(event) => setFrame(Number(event.target.value))}
            />
            <span className="transport-readout">
              {frame + 1}/{totalFrames}
              {raster && ` · ${field?.gridW ?? 0}×${field?.gridH ?? 0} cells · ${raster.width}×${raster.height}`}
            </span>
          </div>

          {message && <p className="notice" role="status">{message}</p>}
        </main>

        <aside className="panel panel-right" aria-label="Output and export">
          <section className="panel-block">
            <h2>output</h2>
            {!halftoning && (
              <div className="field">
                <label htmlFor="seed">seed</label>
                <input
                  id="seed"
                  type="number"
                  min={0}
                  value={settings.seed}
                  onChange={(event) => setGlobal("seed", Math.max(0, Number(event.target.value) >>> 0))}
                />
                <button type="button" onClick={reroll}>reroll</button>
              </div>
            )}

            {halftoning ? (
              <div className="field">
                <label htmlFor="halftone-width">frame</label>
                <select
                  id="halftone-width"
                  value={halftone.width}
                  onChange={(event) => setHalftone("width", Number(event.target.value))}
                >
                  {halftoneWidths.map((width) => (
                    <option key={width} value={width}>{width}px wide</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="toggle-row">
                <button
                  type="button"
                  aria-pressed={settings.colorMode === "mono"}
                  onClick={() => setGlobal("colorMode", "mono")}
                >
                  mono
                </button>
                <button
                  type="button"
                  aria-pressed={settings.colorMode === "source"}
                  onClick={() => setGlobal("colorMode", "source")}
                >
                  source colour
                </button>
              </div>
            )}

            <label className="check">
              <input
                type="checkbox"
                checked={settings.invert}
                onChange={(event) => setGlobal("invert", event.target.checked)}
              />
              invert colour
            </label>
            {!halftoning && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.rampInvert}
                  onChange={(event) => setGlobal("rampInvert", event.target.checked)}
                />
                invert ramp
              </label>
            )}
            <p className="control-hint">
              {halftoning
                ? "invert colour takes the frame's negative: white dots on black, and the "
                  + "colour negative of a plate composite. The dots keep their sizes."
                : "invert colour swaps ink and paper. invert ramp moves the heavy marks onto "
                  + "the bright cells instead of the dark ones."}
            </p>
          </section>

          <section className="panel-block">
            <h2>timing</h2>
            <SliderControl
              label="frame rate"
              value={settings.targetFps}
              min={minFps}
              max={maxFps}
              unit=" fps"
              onChange={(value) => setGlobal("targetFps", Math.round(value))}
            />
            {/* hold and the seamless loop are properties of a cycling band, and
                a halftone has no bands: a still screened at a fixed ruling is
                the same frame every time, so offering either would be a lie. */}
            {!halftoning && (
              <>
                <SliderControl
                  label="hold"
                  value={settings.hold}
                  min={minHold}
                  max={maxHold}
                  onChange={(value) => setGlobal("hold", Math.round(value))}
                />
                <p className="control-hint">
                  {cycling
                    ? `Each mark is held ${settings.hold} frame${settings.hold === 1 ? "" : "s"} — `
                      + `${(settings.targetFps / settings.hold).toFixed(1)} marks a second. `
                      + `Cells are out of phase with each other, so the surface simmers instead of flipping.`
                    : "Put more than one mark on a band and they will cycle. Until then nothing moves."}
                </p>
              </>
            )}
            {media?.kind === "image" && (
              <>
                <SliderControl
                  label="frames"
                  value={settings.stillFrames}
                  min={1}
                  max={240}
                  onChange={(value) => setGlobal("stillFrames", Math.round(value))}
                />
                {halftoning ? (
                  <p className="control-hint">
                    A still under a fixed screen is the same frame every time. Length only
                    matters for a video, or if you want a still held as a clip.
                  </p>
                ) : (
                  <div className="button-row">
                    <button
                      type="button"
                      onClick={() => setGlobal("stillFrames", seamless)}
                      disabled={settings.stillFrames === seamless}
                    >
                      seamless loop: {seamless}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="panel-block">
            <h2>export</h2>
            <div className="toggle-row">
              <button type="button" aria-pressed={format === "png"} onClick={() => setFormat("png")}>
                png
              </button>
              <button
                type="button"
                aria-pressed={format === "mp4"}
                disabled={!mp4Available}
                onClick={() => setFormat("mp4")}
              >
                mp4
              </button>
            </div>

            {format === "png" ? (
              <>
                {(["flat", "ink", "paper"] as ExportInk[]).map((ink) => (
                  <label className="check" key={ink}>
                    <input
                      type="checkbox"
                      checked={inks.includes(ink)}
                      onChange={() => toggleInk(ink)}
                    />
                    {ink === "flat" ? "flat" : ink === "ink" ? "marks → alpha" : "paper → alpha"}
                  </label>
                ))}
                {halftoning && halftone.separation !== "mono" && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={separationPlates}
                      onChange={(event) => setSeparationPlates(event.target.checked)}
                    />
                    separations
                  </label>
                )}
                <p className="control-hint">
                  Each pass gets its own folder in the ZIP. With invert colour that covers all
                  four variants.
                  {halftoning && halftone.separation !== "mono"
                    && " separations adds one folder per plate, black on white — what a printer loads."}
                </p>
              </>
            ) : (
              <p className="control-hint">
                {mp4Available
                  ? "H.264 has no alpha channel, so MP4 is always the flat result."
                  : "This browser has no WebCodecs encoder. Export a PNG sequence instead."}
              </p>
            )}

            <button
              type="button"
              className="primary"
              disabled={!media || busy !== null}
              onClick={() => void runExport()}
            >
              {busy ? `${busy.label} ${busy.done}/${busy.total}` : "export"}
            </button>
            {busy && (
              <button type="button" onClick={() => abortRef.current?.abort()}>cancel</button>
            )}
            {totalFrames >= MAX_EXPORT_FRAMES && (
              <p className="control-hint">Capped at {MAX_EXPORT_FRAMES} frames.</p>
            )}
          </section>

          <section className="panel-block">
            <h2>project</h2>
            <div className="button-row">
              <button type="button" onClick={undo}>undo</button>
              <button type="button" onClick={redo}>redo</button>
              <button type="button" onClick={reset}>reset</button>
            </div>
            <div className="button-row">
              <button type="button" onClick={saveProject}>save</button>
              <label className="button-like">
                load
                <input
                  type="file"
                  accept="application/json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void loadProject(file);
                    event.target.value = "";
                  }}
                />
              </label>
              <button type="button" onClick={copyShareLink}>share</button>
            </div>
          </section>
        </aside>

        {!halftoning && (
        <RampEditor
          settings={settings}
          ramp={ramp}
          library={library}
          libraryVersion={libraryVersion}
          selectedBand={selectedBand}
          playhead={frame}
          onSelect={selectBand}
          onSizeChange={setBandSize}
          onAddFiles={(files, bandIndex) => void addMarkFiles(files, bandIndex)}
          onRemove={removeFromBand}
          onRebalance={rebalanceBands}
        />
        )}
      </div>
    </ToolShell>
  );
}
