import { stageLabels, stageOrder, textureStages, type StageId, type TextureStageId } from "../types";
import { usePrintorStore } from "../store";

/**
 * The pipeline read top to bottom, in the order the shader applies it. Stages
 * are fixed in sequence deliberately — the look depends on grain feeding the
 * torn-edge threshold, and on the paper cuts landing after the print rather
 * than before it.
 */
export function PipelinePanel() {
  const settings = usePrintorStore((state) => state.settings);
  const selected = usePrintorStore((state) => state.selectedStage);
  const selectStage = usePrintorStore((state) => state.selectStage);
  const setStageEnabled = usePrintorStore((state) => state.setStageEnabled);

  return (
    <section className="pipeline-panel" aria-label="Effect pipeline">
      <div className="panel-heading">
        <h2>pipeline</h2>
        <span className="panel-note">{settings.targetFps} fps</span>
      </div>
      <ol className="stage-list">
        {stageOrder.map((id, index) => {
          const stage = settings.stages[id];
          const chance = Math.round(stage.frameChance * 100);
          const empty = textureStages.includes(id as TextureStageId)
            && settings[id as TextureStageId].textures.length === 0;
          return (
            <li key={id}>
              <div
                className={`stage-row${selected === id ? " selected" : ""}${stage.enabled ? "" : " off"}`}
              >
                <input
                  type="checkbox"
                  checked={stage.enabled}
                  aria-label={`Enable ${stageLabels[id]}`}
                  onChange={(event) => setStageEnabled(id, event.target.checked)}
                />
                <button type="button" className="stage-name" onClick={() => selectStage(id)}>
                  <span className="stage-index">{index + 1}</span>
                  <span>{stageLabels[id]}</span>
                </button>
                <span className="stage-chance" title="Fraction of frames this stage runs on">
                  {chance}%
                </span>
              </div>
              {stage.enabled && empty && (
                <p className="stage-warning">no textures selected</p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="pipeline-hint">
        Applied in order, top to bottom. Every frame redraws each parameter from
        its range, so no two frames print alike.
      </p>
    </section>
  );
}

export function stageIsTextured(id: StageId): id is TextureStageId {
  return textureStages.includes(id as TextureStageId);
}
