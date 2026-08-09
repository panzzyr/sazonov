import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolShell } from "./shared/Shell";
import { PipelinePanel } from "./components/PipelinePanel";
import { StageInspector } from "./components/StageInspector";
import { SliderControl } from "./components/RangeControl";
import { Renderer } from "./engine/Renderer";
import { resolveFrame } from "./engine/frameParams";
import { TextureCache } from "./engine/textureCache";
import { downloadBlob, frameCount, MAX_EXPORT_FRAMES, type ExportSource } from "./export/renderSequence";
import { exportPngSequence } from "./export/pngSequence";
import { canEncodeMp4, exportMp4 } from "./export/mp4";
import { decodeSettings, encodeSettings, parseSettings } from "./projectState";
import { initialSettings, usePrintorStore } from "./store";
import { maxFps, minFps, textureStages, type ExportFormat, type ExportInk } from "./types";

const STORAGE_KEY = "printor-project-v3";
const PREVIEW_EDGE = 900;

type LoadedMedia =
  | { kind: "video"; file: File; video: HTMLVideoElement; url: string; width: number; height: number; duration: number }
  | { kind: "image"; file: File; bitmap: ImageBitmap; width: number; height: number; duration: number };

type ExportState = { completed: number; total: number; label: string };

const inkLabels: Record<ExportInk, string> = {
  flat: "grayscale",
  white: "white ink (black → alpha)",
  black: "black ink (white → alpha)",
};

/**
 * Waits for the first decoded frame.
 *
 * A codec the browser cannot decode does not always raise `error` — it can sit
 * in NETWORK_LOADING forever. Without the timeout that reads to the user as a
 * dead drop zone, so treat silence as a decode failure.
 */
function metadata(video: HTMLVideoElement, timeoutMs = 15_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("This browser could not decode that video. Try an H.264 MP4, or export frames from your editor as PNG."));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("This browser cannot decode the selected video."));
    };
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function previewSize(width: number, height: number) {
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(width, height));
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
  };
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const mediaRef = useRef<LoadedMedia | null>(null);
  const cacheRef = useRef(new TextureCache());
  const exportController = useRef<AbortController | null>(null);
  const persistenceReady = useRef(false);
  const redrawRef = useRef<() => void>(() => {});

  const settings = usePrintorStore((state) => state.settings);
  const replaceSettings = usePrintorStore((state) => state.replaceSettings);
  const setGlobal = usePrintorStore((state) => state.setGlobal);
  const reroll = usePrintorStore((state) => state.reroll);
  const undo = usePrintorStore((state) => state.undo);
  const redo = usePrintorStore((state) => state.redo);

  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportState, setExportState] = useState<ExportState | null>(null);
  const [format, setFormat] = useState<ExportFormat>("png");
  const [inks, setInks] = useState<ExportInk[]>(["flat"]);

  const totalFrames = media
    ? frameCount(
        media.kind === "video"
          ? { kind: "video", video: media.video, duration: media.duration }
          : { kind: "image", bitmap: media.bitmap },
        settings,
      )
    : 1;

  /**
   * Draws one frame. Textures that are not decoded yet are requested and the
   * frame is redrawn when they arrive, so the preview fills in rather than
   * flashing an unstyled frame.
   */
  const draw = useCallback((target: LoadedMedia, index: number, original: boolean) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const size = previewSize(target.width, target.height);
    renderer.resize(size.width, size.height);

    const params = resolveFrame(settings, index);
    const cache = cacheRef.current;
    let waiting = false;

    for (const stage of textureStages) {
      const id = params[stage].textureId;
      if (!params.active[stage] || !id) continue;
      const image = cache.get(id);
      if (image) renderer.setStageTexture(stage, image, id);
      else {
        waiting = true;
        void cache.load(id).then((loaded) => {
          if (loaded) redrawRef.current();
        });
      }
    }

    const source = target.kind === "video" ? target.video : target.bitmap;
    renderer.render(source, params, {
      // The preview always shows the flat grayscale result; the ink passes
      // only change how the frame is written to disk.
      ink: "flat",
      invert: settings.invert,
      bypass: original,
    });
    return waiting;
  }, [settings]);

  // `media` is a dependency even though the ref is what gets read: loading a
  // new source must repaint, and the ref alone would not re-run the effect.
  const redraw = useCallback(() => {
    if (mediaRef.current) draw(mediaRef.current, frame, showOriginal);
  }, [draw, frame, showOriginal, media]);

  useEffect(() => {
    redrawRef.current = redraw;
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      rendererRef.current = new Renderer(canvasRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "WebGL2 initialization failed.");
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      const shared = new URLSearchParams(window.location.hash.slice(1)).get("p");
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (shared) replaceSettings(decodeSettings(shared));
      else if (saved) replaceSettings(parseSettings(JSON.parse(saved)));
    } catch {
      setNotice("A saved project could not be restored; defaults were loaded.");
    }
    queueMicrotask(() => {
      persistenceReady.current = true;
    });
  }, [replaceSettings]);

  useEffect(() => {
    if (!persistenceReady.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, settings }));
    } catch {
      // A full or disabled storage quota must not interrupt editing.
    }
  }, [settings]);

  // Warm the cache for the frames the user is most likely to scrub through.
  useEffect(() => {
    const needed = new Set<string>();
    for (let index = 0; index < Math.min(totalFrames, 48); index += 1) {
      const params = resolveFrame(settings, index);
      for (const stage of textureStages) {
        const id = params[stage].textureId;
        if (params.active[stage] && id) needed.add(id);
      }
    }
    void cacheRef.current.preload(needed);
  }, [settings, totalFrames]);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  // Shortening a still sequence can strand the playhead past the last frame.
  useEffect(() => {
    setFrame((current) => Math.min(current, totalFrames - 1));
  }, [totalFrames]);

  useEffect(() => () => {
    const loaded = mediaRef.current;
    if (loaded?.kind === "video") URL.revokeObjectURL(loaded.url);
    if (loaded?.kind === "image") loaded.bitmap.close();
  }, []);

  /** Playback steps whole output frames, so what plays is what exports. */
  useEffect(() => {
    if (!playing || !media || totalFrames < 2) return;
    let cancelled = false;
    let timer = 0;
    let current = frame;

    const step = async () => {
      if (cancelled) return;
      current = (current + 1) % totalFrames;
      // A still has nothing to seek: the frame index alone changes the print.
      if (media.kind === "video") {
        media.video.currentTime = Math.min(media.duration, current / settings.targetFps);
        await new Promise<void>((resolve) => {
          media.video.addEventListener("seeked", () => resolve(), { once: true });
          setTimeout(resolve, 400);
        });
        if (cancelled) return;
      }
      setFrame(current);
      timer = window.setTimeout(step, 1000 / settings.targetFps);
    };

    timer = window.setTimeout(step, 1000 / settings.targetFps);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `frame` is intentionally read once at start; the loop owns it afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, media, settings.targetFps, totalFrames]);

  const goToFrame = useCallback((index: number) => {
    const target = mediaRef.current;
    if (!target) return;
    const next = Math.max(0, Math.min(totalFrames - 1, index));
    setFrame(next);
    if (target.kind === "video") {
      const time = Math.min(target.duration, next / settings.targetFps);
      target.video.currentTime = time;
      target.video.addEventListener("seeked", () => redrawRef.current(), { once: true });
    }
  }, [settings.targetFps, totalFrames]);

  const disposeCurrent = useCallback(() => {
    setPlaying(false);
    const loaded = mediaRef.current;
    if (loaded?.kind === "video") URL.revokeObjectURL(loaded.url);
    if (loaded?.kind === "image") loaded.bitmap.close();
    mediaRef.current = null;
    setMedia(null);
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setError("");
    setNotice("");
    disposeCurrent();
    let pendingUrl = "";
    try {
      if (file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
        const url = URL.createObjectURL(file);
        pendingUrl = url;
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        await metadata(video);
        const loaded: LoadedMedia = {
          kind: "video",
          file,
          video,
          url,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration || 0,
        };
        mediaRef.current = loaded;
        setMedia(loaded);
        setFrame(0);
        video.currentTime = 0;
        pendingUrl = "";
        return;
      }
      if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
        const bitmap = await createImageBitmap(file);
        const loaded: LoadedMedia = {
          kind: "image",
          file,
          bitmap,
          width: bitmap.width,
          height: bitmap.height,
          duration: 0,
        };
        if (/gif$/i.test(file.name)) setNotice("GIF import uses the first decoded frame.");
        mediaRef.current = loaded;
        setMedia(loaded);
        setFrame(0);
        return;
      }
      throw new Error("Use MP4, MOV, WebM, PNG, JPEG, or WebP.");
    } catch (caught) {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      setMedia(null);
      setError(caught instanceof Error ? caught.message : "The selected file could not be opened.");
    }
  }, [disposeCurrent]);

  const toggleInk = (ink: ExportInk) => {
    setInks((current) => {
      if (current.includes(ink)) {
        const next = current.filter((value) => value !== ink);
        return next.length ? next : ["flat"];
      }
      return [...current, ink];
    });
  };

  const runExport = useCallback(async () => {
    const target = mediaRef.current;
    if (!target || exportState) return;
    setPlaying(false);
    setError("");
    const controller = new AbortController();
    exportController.current = controller;

    const source: ExportSource = target.kind === "video"
      ? { kind: "video", video: target.video, duration: target.duration }
      : { kind: "image", bitmap: target.bitmap };
    const total = frameCount(source, settings);
    const stem = target.file.name.replace(/\.[^.]+$/, "") || "printor";

    setExportState({ completed: 0, total, label: format === "mp4" ? "encoding" : "rendering" });
    try {
      if (format === "mp4") {
        const blob = await exportMp4({
          source,
          width: target.width,
          height: target.height,
          settings,
          cache: cacheRef.current,
          signal: controller.signal,
          onProgress: (completed, frames) => setExportState({ completed, total: frames, label: "encoding" }),
        });
        downloadBlob(blob, `${stem}-printor.mp4`);
      } else {
        const blob = await exportPngSequence({
          source,
          width: target.width,
          height: target.height,
          settings,
          cache: cacheRef.current,
          signal: controller.signal,
          inks,
          basename: target.file.name,
          onProgress: (completed, frames) => setExportState({ completed, total: frames, label: "rendering" }),
        });
        downloadBlob(blob, `${stem}-printor.zip`);
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "Export failed.");
      }
    } finally {
      exportController.current = null;
      setExportState(null);
      redrawRef.current();
    }
  }, [exportState, format, inks, settings]);

  const saveProject = useCallback(() => {
    const blob = new Blob([JSON.stringify({ version: 3, settings }, null, 2)], { type: "application/json" });
    downloadBlob(blob, "printor-project.json");
  }, [settings]);

  const copyShareLink = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}#p=${encodeSettings(settings)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Share link copied. It carries the settings only, never your media.");
    } catch {
      window.location.hash = `p=${encodeSettings(settings)}`;
      setNotice("Share link is in the address bar.");
    }
  }, [settings]);

  const loadProject = useCallback(async (file: File) => {
    try {
      replaceSettings(parseSettings(JSON.parse(await file.text())));
      setNotice(`Loaded ${file.name}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That project file could not be read.");
    }
  }, [replaceSettings]);

  useEffect(() => {
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === "\\") setShowOriginal(true);
      if (event.key === " " && media?.kind === "video") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToFrame(frame - (event.shiftKey ? 10 : 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToFrame(frame + (event.shiftKey ? 10 : 1));
      }
      if (event.key.toLowerCase() === "r") reroll();
      if (event.key.toLowerCase() === "e") void runExport();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "\\") setShowOriginal(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [frame, goToFrame, media, redo, reroll, runExport, undo]);

  const mp4Available = useMemo(() => canEncodeMp4(), []);
  // frameCount() already clamps, so totalFrames can never exceed the cap —
  // comparing against it would silently never fire. Ask the source instead.
  const requestedFrames = media
    ? (media.kind === "image"
      ? Math.round(settings.stillFrames)
      : Math.ceil(media.duration * settings.targetFps))
    : 0;
  const truncated = requestedFrames > MAX_EXPORT_FRAMES;

  return (
    <ToolShell name="printor">
      <main className="printor-app">
        <div className="workspace">
          <PipelinePanel />

          <section className="canvas-panel" aria-label="Preview">
            <div
              className="canvas-stage"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void loadFile(file);
              }}
            >
              {!media && (
                <button className="drop-zone" type="button" onClick={() => inputRef.current?.click()}>
                  <strong>Drop a video or image</strong>
                  <span>MP4, MOV, WebM, PNG, JPEG, WebP — nothing leaves this machine</span>
                </button>
              )}
              <canvas ref={canvasRef} hidden={!media} aria-label="Processed preview" />
              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void loadFile(file);
                  event.target.value = "";
                }}
              />
            </div>

            <div className="canvas-meta">
              <span>{media ? media.file.name : "no source"}</span>
              <span>
                {media
                  ? `${media.width}×${media.height} · frame ${frame + 1}/${totalFrames}`
                  : "hold \\ to compare with the source"}
              </span>
            </div>

            <div className="transport">
              <button type="button" onClick={() => goToFrame(frame - 1)} disabled={!media} aria-label="Previous frame">←</button>
              <button type="button" onClick={() => setPlaying((value) => !value)} disabled={!media || totalFrames < 2}>
                {playing ? "pause" : "play"}
              </button>
              <button type="button" onClick={() => goToFrame(frame + 1)} disabled={!media} aria-label="Next frame">→</button>
              <input
                type="range"
                min={0}
                max={Math.max(0, totalFrames - 1)}
                step={1}
                value={frame}
                disabled={!media || totalFrames < 2}
                aria-label="Frame"
                onChange={(event) => goToFrame(Number(event.target.value))}
              />
            </div>

            {notice && <p className="notice" role="status">{notice}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </section>

          <div className="side-column">
            <StageInspector />

            <section className="output-panel" aria-label="Output">
              <div className="panel-heading">
                <h2>output</h2>
                <button type="button" className="ghost" onClick={reroll} title="Redraw every random value">
                  seed {settings.seed} ↻
                </button>
              </div>

              <SliderControl
                label="frame rate"
                value={settings.targetFps}
                min={minFps}
                max={maxFps}
                unit=" fps"
                onChange={(value) => setGlobal("targetFps", value)}
              />

              {media?.kind === "image" && (
                <>
                  <SliderControl
                    label="frames"
                    value={settings.stillFrames}
                    min={1}
                    max={240}
                    onChange={(value) => setGlobal("stillFrames", value)}
                  />
                  <p className="control-hint">
                    A still has nothing to animate, so each frame differs only by
                    its own draw from every range — {(settings.stillFrames / settings.targetFps).toFixed(1)}s
                    at {settings.targetFps} fps.
                  </p>
                </>
              )}

              <label className="toggle-control">
                <input
                  type="checkbox"
                  checked={settings.invert}
                  onChange={(event) => setGlobal("invert", event.target.checked)}
                />
                <span>invert</span>
              </label>

              <div className="format-switch" role="group" aria-label="Export format">
                <button
                  type="button"
                  className={format === "png" ? "active" : ""}
                  onClick={() => setFormat("png")}
                >
                  PNG sequence
                </button>
                <button
                  type="button"
                  className={format === "mp4" ? "active" : ""}
                  disabled={!mp4Available}
                  title={mp4Available ? "" : "This browser has no WebCodecs H.264 encoder."}
                  onClick={() => setFormat("mp4")}
                >
                  MP4
                </button>
              </div>

              {format === "png" ? (
                <fieldset className="ink-passes">
                  <legend>passes</legend>
                  {(["flat", "white", "black"] as ExportInk[]).map((ink) => (
                    <label key={ink} className="toggle-control">
                      <input
                        type="checkbox"
                        checked={inks.includes(ink)}
                        onChange={() => toggleInk(ink)}
                      />
                      <span>{inkLabels[ink]}</span>
                    </label>
                  ))}
                  <p className="control-hint">
                    Each pass is a separate folder in the ZIP. Combine with invert
                    to get all four variants.
                  </p>
                </fieldset>
              ) : (
                <p className="control-hint">
                  MP4 is written at {settings.targetFps} fps in flat grayscale.
                  H.264 has no alpha channel, so the ink passes are PNG-only.
                </p>
              )}

              {truncated && (
                <p className="notice">
                  Only the first {MAX_EXPORT_FRAMES} frames will be exported.
                </p>
              )}

              {exportState ? (
                <div className="export-progress" role="status">
                  <span>{exportState.label} {exportState.completed}/{exportState.total}</span>
                  <progress value={exportState.completed} max={exportState.total} />
                  <button type="button" onClick={() => exportController.current?.abort()}>cancel</button>
                </div>
              ) : (
                <button className="export-button" type="button" disabled={!media} onClick={() => void runExport()}>
                  export {format === "mp4" ? "MP4" : "PNG ZIP"}
                </button>
              )}

              <div className="project-actions">
                <button type="button" onClick={undo}>undo</button>
                <button type="button" onClick={redo}>redo</button>
                <button type="button" onClick={() => replaceSettings(initialSettings())}>reset</button>
              </div>
              <div className="project-actions">
                <button type="button" onClick={saveProject}>save .json</button>
                <button type="button" onClick={() => projectInputRef.current?.click()}>load</button>
                <button type="button" onClick={() => void copyShareLink()}>share link</button>
                <input
                  ref={projectInputRef}
                  className="visually-hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void loadProject(file);
                    event.target.value = "";
                  }}
                />
              </div>
            </section>
          </div>
        </div>
      </main>
    </ToolShell>
  );
}
