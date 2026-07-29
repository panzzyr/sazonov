import { useRef, useState } from "react";
import { presets } from "../presets";
import { encodeSnapshot, parseSnapshot } from "../presetState";
import { usePrintorStore } from "../store";

export function PresetPanel() {
  const applyPreset = usePrintorStore((state) => state.applyPreset);
  const replaceState = usePrintorStore((state) => state.replaceState);
  const settings = usePrintorStore((state) => state.settings);
  const layers = usePrintorStore((state) => state.layers);
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  const exportPreset = () => {
    const blob = new Blob([JSON.stringify({ version: 1, settings, layers }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "preset.printor.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setMessage("Preset exported.");
  };

  const share = async () => {
    const encoded = encodeSnapshot({ settings, layers });
    window.location.hash = `p=${encoded}`;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage("Share link copied.");
    } catch {
      setMessage("Share link is in the address bar.");
    }
  };

  return (
    <aside className="panel preset-panel" aria-labelledby="presets-title">
      <h2 id="presets-title">Presets</h2>
      <div className="preset-list">
        {presets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => applyPreset(preset)}
            title={preset.description}
          >
            <strong>{preset.name}</strong>
            <span>{preset.description}</span>
          </button>
        ))}
      </div>
      <div className="preset-actions">
        <button type="button" onClick={exportPreset}>export JSON</button>
        <button type="button" onClick={() => input.current?.click()}>import</button>
        <button type="button" onClick={() => void share()}>share link</button>
        <input
          ref={input}
          className="visually-hidden"
          type="file"
          accept=".json,.printor.json,application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              replaceState(parseSnapshot(JSON.parse(await file.text())));
              setMessage("Preset imported.");
            } catch (caught) {
              setMessage(caught instanceof Error ? caught.message : "Preset import failed.");
            }
            event.target.value = "";
          }}
        />
      </div>
      {message && <p className="panel-note" role="status">{message}</p>}
    </aside>
  );
}
