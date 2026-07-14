import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import { MUSIC_KITS, musicKitName } from "../data/musicKits";
import { useT } from "../i18n";
import { api, type KnifeCustomizerConfig } from "../lib/api";
import { useStore } from "../state/store";
import "./WeaponPresetsPanel.css";

type Props = {
  open: boolean;
  csgoPath: string | null;
  config: KnifeCustomizerConfig | null;
  onSaved: (config: KnifeCustomizerConfig) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
};

export default function MusicKitPresetModal({ open, csgoPath, config, onSaved, onError, onClose }: Props) {
  const t = useT();
  const { config: appConfig } = useStore();
  const language = appConfig?.language;
  const [selectedId, setSelectedId] = useState(0);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedId(config?.music_kit_id ?? 0);
    setQuery("");
  }, [open, config]);

  const selected = MUSIC_KITS.find((kit) => kit.def_index === selectedId);
  const visible = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return MUSIC_KITS.filter((kit) => !value || `${kit.name_en} ${kit.name_zh} ${kit.def_index}`.toLocaleLowerCase().includes(value));
  }, [query]);

  const persist = async (musicKitId: number) => {
    if (!csgoPath || !config) return;
    setSaving(true);
    try {
      const state = await api.saveKnifeCustomizer(csgoPath, { ...config, enabled: true, music_kit_id: musicKitId });
      onSaved(state.config);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return <Modal open={open} title={t("music.select")} onClose={onClose} width={440} footer={<>
    <button className="wp-modal__remove" disabled={saving || !(config?.music_kit_id ?? 0)} onClick={() => void persist(0)}>{t("music.remove")}</button>
    <button className="kp__save" disabled={saving || !selected} onClick={() => void persist(selectedId)}>{saving ? t("music.saving") : t("music.apply")}</button>
  </>}>
    <div className="mk-modal">
      <div className="mk-modal__preview">
        {selected ? <img src={selected.image} alt="" /> : <span>Steam</span>}
        <div><strong>{selected ? musicKitName(selected, language) : t("music.default")}</strong>{selected && <small>ID {selected.def_index}</small>}</div>
      </div>
      <label className="kp__field"><span>{t("music.title")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("music.search")} /></label>
      {visible.length ? <div className="mk-modal__list">{visible.map((kit) => <button key={kit.def_index} className={kit.def_index === selectedId ? "is-selected" : ""} onClick={() => setSelectedId(kit.def_index)}>
        <img src={kit.image} alt="" loading="lazy" />
        <span>{musicKitName(kit, language)}<small>ID {kit.def_index}</small></span>
      </button>)}</div> : <div className="wp-modal__empty">{t("music.noResults")}</div>}
    </div>
  </Modal>;
}
