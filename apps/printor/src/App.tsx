import { useCallback, useEffect, useRef, useState } from "react";
import { PrivacyLine, ToolShell } from "@sazonov/shell";
import { Inspector } from "./components/Inspector";
import { LayersPanel } from "./components/LayersPanel";
import { PresetPanel } from "./components/PresetPanel";
import { Renderer } from "./engine/Renderer";
import { downloadBlob, exportPngSequence } from "./export/pngSequence";
import { decodeSnapshot, parseSnapshot } from "./presetState";
import { usePrintorStore } from "./store";

type LoadedMedia =
  | {
      kind: "video";
      file: File;
      video: HTMLVideoElement;
      url: string;
      width: number;
      height: number;
      duration: number;
    }
  | {
      kind: "image";
      file: File;
      bitmap: ImageBitmap;
      width: number;
      height: number;
      duration: number;
    };

type ExportState = {
  completed: number;
  total: number;
};

function metadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("This browser cannot decode the selected video."));
    };
    const cleanup = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function previewSize(width: number, height: number) {
  const scale = Math.min(1, 720 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function mediaLabel(media: LoadedMedia) {
  const dimensions = `${media.width}×${media.height}`;
  if (media.kind === "image") return `${dimensions} · 1 frame`;
  return `${dimensions} · ${media.duration.toFixed(1)}s`;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const mediaRef = useRef<LoadedMedia | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const persistenceReady = useRef(false);
  const settings = usePrintorStore((state) => state.settings);
  const layers = usePrintorStore((state) => state.layers);
  const setSetting = usePrintorStore((state) => state.setSetting);
  const reroll = usePrintorStore((state) => state.reroll);
  const reset = usePrintorStore((state) => state.reset);
  const replaceState = usePrintorStore((state) => state.replaceState);
  const undo = usePrintorStore((state) => state.undo);
  const redo = usePrintorStore((state) => state.redo);
  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [fit, setFit] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [exportState, setExportState] = useState<ExportState | null>(null);

  const draw = useCallback((target: LoadedMedia, time = currentTime, original = showOriginal) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const size = previewSize(target.width, target.height);
    renderer.resize(size.width, size.height);
    const source = target.kind === "video" ? target.video : target.bitmap;
    const frame = target.kind === "video" ? Math.floor(time * settings.targetFps) : 0;
    renderer.render(source, settings, layers, frame, original);
  }, [currentTime, layers, settings, showOriginal]);

  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      rendererRef.current = new Renderer(canvasRef.current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "WebGL2 initialization failed.");
    }
  }, []);

  useEffect(() => {
    try {
      const shared = new URLSearchParams(window.location.hash.slice(1)).get("p");
      const saved = window.localStorage.getItem("printor-project-v1");
      if (shared) replaceState(decodeSnapshot(shared));
      else if (saved) replaceState(parseSnapshot(JSON.parse(saved)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Saved project could not be restored.");
    }
    queueMicrotask(() => {
      persistenceReady.current = true;
    });
  }, [replaceState]);

  useEffect(() => {
    if (!persistenceReady.current) return;
    window.localStorage.setItem("printor-project-v1", JSON.stringify({ settings, layers }));
  }, [layers, settings]);

  useEffect(() => {
    mediaRef.current = media;
    if (media) draw(media);
  }, [draw, media]);

  useEffect(() => () => {
    const loaded = mediaRef.current;
    if (loaded?.kind === "video") URL.revokeObjectURL(loaded.url);
    if (loaded?.kind === "image") loaded.bitmap.close();
  }, []);

  useEffect(() => {
    if (!playing || media?.kind !== "video") return;
    let animationFrame = 0;
    const video = media.video;
    void video.play().catch(() => setPlaying(false));
    const tick = () => {
      const time = video.currentTime;
      setCurrentTime(time);
      draw(media, time);
      if (!video.ended && !video.paused) animationFrame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animationFrame);
      video.pause();
    };
  }, [draw, media, playing]);

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
    setWarning("");
    disposeCurrent();
    let pendingUrl = "";
    try {
      if (file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name)) {
        const url = URL.createObjectURL(file);
        pendingUrl = url;
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        await metadata(video);
        const duration = Math.min(30, video.duration || 0);
        if (video.duration > 30) setWarning("Only the first 30 seconds will be exported in this release.");
        if (Math.max(video.videoWidth, video.videoHeight) > 1920) {
          setWarning("This source is above 1080p. Preview is proxied; full export may use substantial memory.");
        }
        const loaded: LoadedMedia = {
          kind: "video",
          file,
          video,
          url,
          width: video.videoWidth,
          height: video.videoHeight,
          duration,
        };
        setCurrentTime(0);
        mediaRef.current = loaded;
        setMedia(loaded);
        pendingUrl = "";
        draw(loaded, 0);
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
        if (/gif$/i.test(file.name)) setWarning("GIF import currently uses its first decoded frame.");
        setCurrentTime(0);
        mediaRef.current = loaded;
        setMedia(loaded);
        draw(loaded, 0);
        return;
      }
      throw new Error("Use MP4, MOV, WebM, GIF, PNG, JPEG, or WebP.");
    } catch (caught) {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      setMedia(null);
      setError(caught instanceof Error ? caught.message : "The selected file could not be opened.");
    }
  }, [disposeCurrent, draw]);

  const seekTo = useCallback((time: number) => {
    if (media?.kind !== "video") return;
    setPlaying(false);
    const next = Math.max(0, Math.min(Math.max(0, media.duration - 0.001), time));
    media.video.currentTime = next;
    setCurrentTime(next);
    media.video.addEventListener("seeked", () => draw(media, next), { once: true });
  }, [draw, media]);

  const exportFrames = useCallback(async () => {
    if (!media || exportState) return;
    setPlaying(false);
    setError("");
    const controller = new AbortController();
    exportController.current = controller;
    const total = media.kind === "video"
      ? Math.min(300, Math.max(1, Math.ceil(media.duration * settings.targetFps)))
      : 1;
    setExportState({ completed: 0, total });
    try {
      const blob = await exportPngSequence({
        source: media.kind === "video"
          ? { kind: "video", video: media.video, duration: media.duration }
          : { kind: "image", bitmap: media.bitmap },
        width: media.width,
        height: media.height,
        basename: media.file.name,
        settings,
        layers,
        signal: controller.signal,
        onProgress: (completed, frameTotal) => setExportState({ completed, total: frameTotal }),
      });
      downloadBlob(blob, `${media.file.name.replace(/\.[^.]+$/, "")}-printor.zip`);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "Export failed.");
      }
    } finally {
      exportController.current = null;
      setExportState(null);
      draw(media);
    }
  }, [draw, exportState, layers, media, settings]);

  useEffect(() => {
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === "\\") {
        setShowOriginal(true);
        if (media) draw(media, currentTime, true);
      }
      if (event.key === " " && media?.kind === "video") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekTo(currentTime - (event.shiftKey ? 10 : 1) / settings.targetFps);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekTo(currentTime + (event.shiftKey ? 10 : 1) / settings.targetFps);
      }
      if (event.key.toLowerCase() === "r") reroll();
      if (event.key.toLowerCase() === "e") void exportFrames();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "\\") {
        setShowOriginal(false);
        if (media) draw(media, currentTime, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [currentTime, draw, exportFrames, media, redo, reroll, seekTo, settings.targetFps, undo]);

  return (
    <ToolShell>
      <main className="printor-app">
        <div className="workspace">
          <PresetPanel />
          <LayersPanel />
          <section className="canvas-panel" aria-label="Preview">
            <div className="canvas-heading">
              <h2>Canvas</h2>
              <div className="view-options">
                <button className={fit ? "active" : ""} type="button" onClick={() => setFit(true)}>fit</button>
                <button className={!fit ? "active" : ""} type="button" onClick={() => setFit(false)}>100%</button>
              </div>
            </div>
            <div
              className={`canvas-stage${fit ? " fit" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void loadFile(file);
              }}
            >
              {!media && (
                <button className="drop-zone" type="button" onClick={() => inputRef.current?.click()}>
                  <strong>Drop a video here</strong>
                  <span>or choose a file</span>
                </button>
              )}
              <canvas ref={canvasRef} hidden={!media} aria-label="Processed media preview" />
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
              <span>{media ? mediaLabel(media) : "≤30s · ≤300 frames"}</span>
            </div>
            <PrivacyLine />
            {warning && <p className="notice" role="status">{warning}</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </section>
          <Inspector />
          <section className="transport" aria-label="Transport and export">
            <div className="transport-buttons">
              <button type="button" onClick={() => seekTo(currentTime - 1 / settings.targetFps)} disabled={media?.kind !== "video"} aria-label="Previous frame">←</button>
              <button type="button" onClick={() => setPlaying((value) => !value)} disabled={media?.kind !== "video"}>{playing ? "pause" : "play"}</button>
              <button type="button" onClick={() => seekTo(currentTime + 1 / settings.targetFps)} disabled={media?.kind !== "video"} aria-label="Next frame">→</button>
            </div>
            <label className="time-control">
              <span>{currentTime.toFixed(2)} / {media?.kind === "video" ? media.duration.toFixed(2) : "0.00"}s</span>
              <input type="range" min={0} max={media?.kind === "video" ? media.duration : 0} step={media?.kind === "video" ? 1 / settings.targetFps : 1} value={currentTime} disabled={media?.kind !== "video"} onChange={(event) => seekTo(Number(event.target.value))} />
            </label>
            <label className="compact-control">
              <span>fps</span>
              <input type="number" min={1} max={30} value={settings.targetFps} onChange={(event) => setSetting("targetFps", Math.max(1, Math.min(30, Number(event.target.value))))} />
            </label>
            <div className="seed-control">
              <span>seed {settings.seed}</span>
              <button type="button" onClick={reroll} aria-label="Reroll seed">↻</button>
            </div>
            <label className="chaos-control">
              <span>chaos</span>
              <input type="range" min={0} max={1} step={0.01} value={settings.chaos} onChange={(event) => setSetting("chaos", Number(event.target.value))} />
            </label>
            <div className="history-buttons">
              <button type="button" onClick={undo} aria-label="Undo">undo</button>
              <button type="button" onClick={redo} aria-label="Redo">redo</button>
              <button type="button" onClick={reset}>reset</button>
            </div>
            {exportState ? (
              <div className="export-progress" role="status">
                <span>{exportState.completed}/{exportState.total}</span>
                <progress value={exportState.completed} max={exportState.total} />
                <button type="button" onClick={() => exportController.current?.abort()}>cancel</button>
              </div>
            ) : (
              <button className="export-button" type="button" disabled={!media} onClick={() => void exportFrames()}>export PNG ZIP</button>
            )}
          </section>
        </div>
      </main>
    </ToolShell>
  );
}
