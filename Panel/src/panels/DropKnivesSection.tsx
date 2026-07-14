import { useEffect, useState } from "react";
import Section from "../components/Section";
import type { Status } from "../components/StatusDot";
import { useStore } from "../state/store";
import { useT } from "../i18n";
import { KNIFE_ICONS } from "../data/knifeIcons";
import { itemName, localizedSkinName } from "../data/skinLocalization";
import { captureKeyName } from "../lib/keycapture";
import { api, type KnifeCustomizerConfig } from "../lib/api";
import KnifePresetModal from "./KnifePresetModal";
import GlovePresetModal from "./GlovePresetModal";
import "./DropKnivesSection.css";

const DEFAULT_GLOVE = { defindex: 5030, paint: 10048, seed: 0, wear: 0.01 };

export default function DropKnivesSection() {
  const { dropKnives, csgoPath, applyDropKnives, dropKnivesPending, reportError, config: appConfig } = useStore();
  const t = useT();
  const [capturing, setCapturing] = useState(false);
  const [editingKnife, setEditingKnife] = useState<(typeof KNIFE_ICONS)[number] | null>(null);
  const [knifeConfig, setKnifeConfig] = useState<KnifeCustomizerConfig | null>(null);
  const [editingGlove, setEditingGlove] = useState(false);

  useEffect(() => {
    if (!csgoPath) return;
    api.getKnifeCustomizer(csgoPath).then((state) => setKnifeConfig(state.config)).catch(() => setKnifeConfig(null));
  }, [csgoPath]);

  const bindKey = dropKnives?.bind_key ?? "\\";
  const selected = new Set(dropKnives?.selected ?? []);
  const cfgPresent = dropKnives?.cfg_present ?? false;
  const running = dropKnives?.cs2_running ?? false;
  const disabled = !csgoPath || !cfgPresent;

  // Yellow only if Drop Knives was changed while CS2 is running (pending restart).
  const status: Status =
    !csgoPath ? "off" : !cfgPresent ? "red" : running && dropKnivesPending ? "yellow" : "green";

  // Key capture: grab the first keydown after the box is clicked.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const name = captureKeyName(e);
      setCapturing(false);
      applyDropKnives(name, Array.from(selected));
    };
    window.addEventListener("keydown", onKey, { capture: true, once: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const toggle = (id: number) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // keep numeric order for a stable bind string
    const ordered = KNIFE_ICONS.map((k) => k.id).filter((i) => next.has(i));
    applyDropKnives(bindKey, ordered);
  };

  const toggleGlove = async () => {
    if (disabled || !csgoPath || !knifeConfig) return;
    try {
      const current = knifeConfig.glove;
      const preset = current.defindex > 0 && current.paint > 0 ? current : DEFAULT_GLOVE;
      const state = await api.saveKnifeCustomizer(csgoPath, {
        ...knifeConfig,
        enabled: true,
        glove: { ...preset, enabled: !current.enabled },
      });
      setKnifeConfig(state.config);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <Section title={t("pre.dropKnives")} status={status}>
      <div className="dk__bind">
        <span className="dk__bind-label">{t("pre.bind")}</span>
        <button
          className={`dk__bind-box ${capturing ? "is-capturing" : ""}`}
          disabled={disabled}
          onClick={() => setCapturing(true)}
          title={t("cosmetics.keyHint")}
        >
          {capturing ? t("pre.pressKey") : bindKey === "\\" ? "\\" : bindKey}
        </button>
      </div>

      <div className={`dk__grid ${disabled ? "is-disabled" : ""}`}>
        {KNIFE_ICONS.map((k) => (
          <button
            key={k.id}
            className={`dk__knife ${selected.has(k.id) ? "is-selected" : ""}`}
            onClick={() => toggle(k.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              if (!disabled) setEditingKnife(k);
            }}
            disabled={disabled}
            title={`${itemName(localizedSkinName(appConfig?.language, k.id, 0, `Knife ${k.id}`))} · ${t("cosmetics.leftRight")}`}
            aria-pressed={selected.has(k.id)}
          >
            <img src={k.url} alt={`knife ${k.id}`} draggable={false} />
          </button>
        ))}
      </div>
      <button
        className={`dk__glove ${knifeConfig?.glove?.enabled ? "is-selected" : ""}`}
        disabled={disabled}
        onClick={() => void toggleGlove()}
        onContextMenu={(event) => { event.preventDefault(); if (!disabled) setEditingGlove(true); }}
        title={t("cosmetics.gloveLeftRight")}
      >
        <span className="dk__glove-label">{t("cosmetics.playerGloves")}</span>
        <span className="dk__glove-value">{knifeConfig?.glove?.enabled ? `${t("cosmetics.enabled")} · ${knifeConfig.glove.paint}` : t("cosmetics.disabled")}</span>
      </button>
      <KnifePresetModal
        knife={editingKnife}
        csgoPath={csgoPath}
        config={knifeConfig}
        onSaved={setKnifeConfig}
        onError={reportError}
        onClose={() => setEditingKnife(null)}
      />
      <GlovePresetModal
        open={editingGlove}
        csgoPath={csgoPath}
        config={knifeConfig}
        onSaved={setKnifeConfig}
        onError={reportError}
        onClose={() => setEditingGlove(false)}
      />
    </Section>
  );
}
