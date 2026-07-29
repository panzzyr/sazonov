import { useState } from "react";
import { usePrintorStore } from "../store";
import type { LayerId } from "../types";

const labels: Record<LayerId, string> = {
  levels: "Levels",
  noise: "Noise",
  print: "Dither / halftone",
  paper: "Paper scan",
};

export function LayersPanel() {
  const layers = usePrintorStore((state) => state.layers);
  const selected = usePrintorStore((state) => state.selectedLayer);
  const select = usePrintorStore((state) => state.selectLayer);
  const toggle = usePrintorStore((state) => state.toggleLayer);
  const move = usePrintorStore((state) => state.moveLayer);
  const [dragged, setDragged] = useState<number | null>(null);

  return (
    <aside className="panel layers-panel" aria-labelledby="layers-title">
      <h2 id="layers-title">Layers</h2>
      <div className="timebase-layer">
        <span>01</span>
        <strong>Timebase</strong>
        <small>fixed</small>
      </div>
      <ol>
        {layers.map((layer, index) => (
          <li
            key={layer.id}
            draggable
            data-selected={selected === layer.id}
            onDragStart={() => setDragged(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragged !== null && dragged !== index) move(dragged, index);
              setDragged(null);
            }}
          >
            <button
              className="layer-select"
              type="button"
              onClick={() => select(layer.id)}
              aria-pressed={selected === layer.id}
            >
              <span>{String(index + 2).padStart(2, "0")}</span>
              <strong>{labels[layer.id]}</strong>
            </button>
            <button
              className="layer-toggle"
              type="button"
              aria-label={`${layer.enabled ? "Disable" : "Enable"} ${labels[layer.id]}`}
              aria-pressed={layer.enabled}
              onClick={() => toggle(layer.id)}
            >
              {layer.enabled ? "on" : "off"}
            </button>
            <div className="layer-move">
              <button
                type="button"
                aria-label={`Move ${labels[layer.id]} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >↑</button>
              <button
                type="button"
                aria-label={`Move ${labels[layer.id]} down`}
                disabled={index === layers.length - 1}
                onClick={() => move(index, index + 1)}
              >↓</button>
            </div>
          </li>
        ))}
      </ol>
      <p className="panel-note">Drag layers or use arrows. Processing runs bottom to top.</p>
    </aside>
  );
}
