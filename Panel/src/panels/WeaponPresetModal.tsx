import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import Toggle from "../components/Toggle";
import { useT } from "../i18n";
import { api, type KnifeCustomizerConfig, type KnifePreset } from "../lib/api";
import type { WeaponIcon } from "../data/weaponIcons";
import catalogRows from "../data/weaponSkins.json";
import imageRows from "../data/skinImages.json";
import { localizedSkinName } from "../data/skinLocalization";
import { useStore } from "../state/store";
import "./KnifePresetModal.css";
import "./WeaponPresetsPanel.css";

type CatalogSkin = { weapon_defindex: number; paint: number; name: string; min_wear: number; max_wear: number; stattrak: boolean; souvenir: boolean };
type ImageSkin = { weapon_defindex: number; paint: number | string; image: string };
type Skin = CatalogSkin & { image?: string };
const DEFAULT: KnifePreset = { paint: 0, seed: 0, wear: 0.01, name_tag: "", stattrak_enabled: false, stattrak_count: 0, souvenir_enabled: false };
const images = new Map((imageRows as ImageSkin[]).map((row) => [`${row.weapon_defindex}:${Number(row.paint)}`, row.image]));

type Props = { weapon: WeaponIcon | null; csgoPath: string | null; config: KnifeCustomizerConfig | null; onSaved: (config: KnifeCustomizerConfig) => void; onError: (error: unknown) => void; onClose: () => void };

export default function WeaponPresetModal({ weapon, csgoPath, config, onSaved, onError, onClose }: Props) {
  const t = useT();
  const { config: appConfig } = useStore();
  const [draft, setDraft] = useState<KnifePreset>(DEFAULT);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const allSkins = useMemo<Skin[]>(() => !weapon ? [] : (catalogRows as CatalogSkin[]).filter((row) => row.weapon_defindex === weapon.id && row.paint > 0).map((row) => ({ ...row, image: images.get(`${row.weapon_defindex}:${row.paint}`) })), [weapon]);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return allSkins.filter((skin) => !q || `${localizedSkinName(appConfig?.language, skin.weapon_defindex, skin.paint, skin.name)} ${skin.paint}`.toLocaleLowerCase().includes(q));
  }, [allSkins, appConfig?.language, query]);
  const selected = allSkins.find((skin) => skin.paint === draft.paint);

  useEffect(() => {
    if (!weapon || !config) return;
    const existing = config.gun_presets?.[String(weapon.id)];
    const first = allSkins[0];
    setDraft({ ...DEFAULT, ...(existing ?? (first ? { paint: first.paint, wear: first.min_wear } : {})) });
    setQuery("");
  }, [weapon, config, allSkins]);

  const choose = (skin: Skin) => setDraft((value) => ({ ...value, paint: skin.paint, wear: Math.min(skin.max_wear, Math.max(skin.min_wear, value.wear)), stattrak_enabled: skin.stattrak && value.stattrak_enabled, souvenir_enabled: skin.souvenir && value.souvenir_enabled }));
  const persist = async (remove = false) => {
    if (!weapon || !csgoPath || !config) return;
    setSaving(true);
    try {
      const presets = { ...(config.gun_presets ?? {}) };
      if (remove) delete presets[String(weapon.id)]; else presets[String(weapon.id)] = draft;
      const state = await api.saveKnifeCustomizer(csgoPath, { ...config, enabled: true, gun_presets: presets });
      onSaved(state.config); onClose();
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  return <Modal open={!!weapon} title={weapon ? `${weapon.name} · ${t("weapons.title")}` : t("weapons.title")} onClose={onClose} width={440} footer={<><button className="wp-modal__remove" disabled={saving || !weapon || !config?.gun_presets?.[String(weapon.id)]} onClick={() => void persist(true)}>{t("weapons.remove")}</button><button className="kp__save" disabled={saving || !selected} onClick={() => void persist()}>{saving ? t("weapons.saving") : t("weapons.apply")}</button></>}>
    <div className="kp">
      <div className="kp__preview"><img src={selected?.image || weapon?.url} alt="" /><div><strong>{selected ? localizedSkinName(appConfig?.language, selected.weapon_defindex, selected.paint, selected.name) : t("weapons.noSkins")}</strong><span>{t("cosmetics.paintKit")} {draft.paint || "-"}</span></div></div>
      <label className="kp__field"><span>{t("weapons.paint")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("weapons.search")} /></label>
      {visible.length ? <div className="kp__skins">{visible.map((skin) => <button key={skin.paint} className={skin.paint === draft.paint ? "is-selected" : ""} onClick={() => choose(skin)}><img src={skin.image || weapon?.url} alt="" loading="lazy" /><span>{localizedSkinName(appConfig?.language, skin.weapon_defindex, skin.paint, skin.name)} [{skin.paint}]</span></button>)}</div> : <div className="wp-modal__empty">{t("weapons.noSkins")}</div>}
      <div className="kp__columns"><label className="kp__field"><span>{t("live.wear")}</span><input type="number" min={selected?.min_wear ?? 0} max={selected?.max_wear ?? 1} step="0.000001" value={draft.wear} onChange={(event) => setDraft((value) => ({ ...value, wear: Math.min(selected?.max_wear ?? 1, Math.max(selected?.min_wear ?? 0, Number(event.target.value))) }))} /></label><label className="kp__field"><span>{t("live.seed")}</span><input type="number" min="0" max="1000" step="1" value={draft.seed} onChange={(event) => setDraft((value) => ({ ...value, seed: Math.min(1000, Math.max(0, Number(event.target.value))) }))} /></label></div>
      <label className="kp__field"><span>{t("live.nameTag")}</span><input maxLength={20} value={draft.name_tag} onChange={(event) => setDraft((value) => ({ ...value, name_tag: event.target.value }))} /></label>
      <div className="kp__toggle-row"><span>{t("live.stattrak")}</span><Toggle checked={draft.stattrak_enabled} disabled={!selected?.stattrak} onChange={(enabled) => setDraft((value) => ({ ...value, stattrak_enabled: enabled, souvenir_enabled: enabled ? false : value.souvenir_enabled }))} /></div>
      {draft.stattrak_enabled && <label className="kp__field"><span>{t("live.count")}</span><input type="number" min="0" step="1" value={draft.stattrak_count} onChange={(event) => setDraft((value) => ({ ...value, stattrak_count: Math.max(0, Number(event.target.value)) }))} /></label>}
      <div className="kp__toggle-row"><span>{t("live.souvenir")}</span><Toggle checked={!!draft.souvenir_enabled} disabled={!selected?.souvenir} onChange={(enabled) => setDraft((value) => ({ ...value, souvenir_enabled: enabled, stattrak_enabled: enabled ? false : value.stattrak_enabled }))} /></div>
    </div>
  </Modal>;
}
