import { texturesByGroup } from "../generatedTextures";
import { stageTextureGroup, type TextureStageId } from "../types";
import { usePrintorStore } from "../store";

const base = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

type TexturePickerProps = {
  stage: TextureStageId;
};

/**
 * Multi-select over the shipped library. The selection is a pool, not a
 * choice: each frame picks one member at random, so selecting more textures
 * widens the variation rather than layering them.
 */
export function TexturePicker({ stage }: TexturePickerProps) {
  const selected = usePrintorStore((state) => state.settings[stage].textures);
  const setTextures = usePrintorStore((state) => state.setTextures);
  const group = texturesByGroup.get(stageTextureGroup[stage]) ?? [];
  const chosen = new Set(selected);

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTextures(stage, group.filter((texture) => next.has(texture.id)).map((texture) => texture.id));
  };

  return (
    <div className="texture-picker">
      <div className="picker-head">
        <span>{chosen.size} of {group.length} selected</span>
        <div className="picker-actions">
          <button type="button" onClick={() => setTextures(stage, group.map((texture) => texture.id))}>
            all
          </button>
          <button type="button" onClick={() => setTextures(stage, [])}>none</button>
        </div>
      </div>
      {group.length === 0 ? (
        <p className="control-hint">
          No textures in this group. Run the texture library build to add them.
        </p>
      ) : (
        <ul className="texture-grid">
          {group.map((texture) => (
            <li key={texture.id}>
              <button
                type="button"
                className={`texture-swatch${chosen.has(texture.id) ? " selected" : ""}`}
                aria-pressed={chosen.has(texture.id)}
                title={texture.name}
                onClick={() => toggle(texture.id)}
              >
                <img src={`${base}textures/${texture.file}`} alt="" loading="lazy" decoding="async" />
                <span>{texture.name.replace(/^[a-z ]+/, "")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
