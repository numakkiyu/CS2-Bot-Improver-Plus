import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import Toggle from "../components/Toggle";
import WearGauge from "../components/WearGauge";
import { api, type KnifeCustomizerConfig, type KnifePreset } from "../lib/api";
import type { KnifeIcon } from "../data/knifeIcons";
import imageRows from "../data/skinImages.json";
import catalogRows from "../data/weaponSkins.json";
import { finishName, itemName, localizedSkinName } from "../data/skinLocalization";
import { useT, type I18nKey } from "../i18n";
import { useStore } from "../state/store";
import CosmeticsTeamSwitch, { useCosmeticsTeam } from "../components/CosmeticsTeamSwitch";
import { useSelectedPickerScroll } from "../lib/useSelectedPickerScroll";
import "./KnifePresetModal.css";

type SkinImage = {
  weapon_defindex: number;
  paint: number;
  image: string;
};

type CatalogSkin = {
  weapon_defindex: number;
  paint: number;
  name: string;
  min_wear: number;
  max_wear: number;
  stattrak: boolean;
};

const DEFAULT_PRESET: KnifePreset = {
  paint: 0,
  seed: 0,
  wear: 0.01,
  name_tag: "",
  stattrak_enabled: false,
  stattrak_count: 0,
};

const PHASE_NAMES: Record<number, I18nKey | string> = {
  415: "phase.ruby", 416: "phase.sapphire", 417: "phase.blackPearl",
  418: "P1", 419: "P2", 420: "P3", 421: "P4", 568: "phase.emerald",
  569: "P1", 570: "P2", 571: "P3", 572: "P4", 617: "phase.blackPearl",
  618: "P2", 619: "phase.sapphire", 852: "P1", 853: "P2", 854: "P3",
  855: "P4", 856: "phase.ruby", 857: "phase.sapphire", 858: "phase.blackPearl",
};

type Props = {
  knife: KnifeIcon | null;
  csgoPath: string | null;
  config: KnifeCustomizerConfig | null;
  onSaved: (config: KnifeCustomizerConfig) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
};

export default function KnifePresetModal({ knife, csgoPath, config, onSaved, onError, onClose }: Props) {
  const t = useT();
  const { config: appConfig } = useStore();
  const language = appConfig?.language;
  const [draft, setDraft] = useState<KnifePreset>(DEFAULT_PRESET);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [useAsDefault, setUseAsDefault] = useState(false);
  const [team, setTeam] = useCosmeticsTeam();
  const skinListRef = useSelectedPickerScroll(!!knife, `${team}:${draft.paint}`);

  useEffect(() => {
    if (!knife || !config) return;
    const loadout = config.loadouts[team];
    setDraft({ ...DEFAULT_PRESET, ...(loadout.knife_presets[String(knife.id)] ?? {}) });
    setQuery("");
    setUseAsDefault(loadout.default_knife_defindex === knife.id);
  }, [knife, team, config]);

  const allSkins = useMemo(() => !knife ? [] : (imageRows as SkinImage[])
    .filter((row) => row.weapon_defindex === knife.id && row.paint > 0), [knife]);
  const catalog = useMemo(() => new Map((catalogRows as CatalogSkin[])
    .map((row) => [`${row.weapon_defindex}:${row.paint}`, row])), []);
  const label = (row: SkinImage) => {
    const full = localizedSkinName(language, row.weapon_defindex, row.paint);
    const phase = PHASE_NAMES[row.paint];
    const phaseLabel = typeof phase === "string" && phase.startsWith("phase.")
      ? t(phase as I18nKey)
      : phase;
    return `${finishName(full)}${phaseLabel ? ` · ${phaseLabel}` : ""} [${row.paint}]`;
  };
  const skins = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return allSkins.filter((row) => !q || label(row).toLocaleLowerCase().includes(q));
  // The label follows the selected Panel language.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSkins, language, query]);
  const selectedSkin = allSkins.find((row) => row.paint === draft.paint);
  const selectedCatalog = knife ? catalog.get(`${knife.id}:${draft.paint}`) : undefined;

  const choose = (skin: SkinImage) => {
    const details = catalog.get(`${skin.weapon_defindex}:${skin.paint}`);
    setDraft((value) => ({
      ...value,
      paint: skin.paint,
      wear: Math.min(details?.max_wear ?? 1, Math.max(details?.min_wear ?? 0, value.wear)),
      stattrak_enabled: !!details?.stattrak && value.stattrak_enabled,
    }));
  };

  const save = async () => {
    if (!knife || !csgoPath || !config) return;
    setSaving(true);
    try {
      const loadout = config.loadouts[team];
      const next: KnifeCustomizerConfig = {
        ...config,
        enabled: true,
        loadouts: {
          ...config.loadouts,
          [team]: {
            ...loadout,
            default_knife_defindex: useAsDefault
              ? knife.id
              : loadout.default_knife_defindex === knife.id ? 0 : loadout.default_knife_defindex,
            knife_presets: { ...loadout.knife_presets, [String(knife.id)]: draft },
          },
        },
      };
      const state = await api.saveKnifeCustomizer(csgoPath, next);
      onSaved(state.config);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  const knifeName = knife ? itemName(localizedSkinName(language, knife.id, 0, `Knife ${knife.id}`)) : "";

  return <Modal open={!!knife} title={knife ? `${knifeName} · ${t("cosmetics.knifeTitle")}` : t("cosmetics.knifeTitle")} onClose={onClose} width={880} scrimClassName="picker-modal" footer={
    <div className="kp__footer-actions"><button className="kp__save" disabled={saving || draft.paint <= 0} onClick={() => void save()}>
      {saving ? t("cosmetics.saving") : t("cosmetics.save")}
    </button></div>
  }>
    <div className="kp kp--split">
      <div className="kp__side">
        <div className="kp__preview">
          <span className="kp__team-fab"><CosmeticsTeamSwitch value={team} onChange={setTeam} ariaLabel={t("cosmetics.teamLoadout")} compact /></span>
          <img src={selectedSkin?.image || knife?.url} alt="" />
          <div><strong>{selectedSkin ? label(selectedSkin) : t("cosmetics.chooseSkin")}</strong><span>{t("cosmetics.paintKit")} {draft.paint || "-"}</span></div>
        </div>
        <div className="kp__columns"><label className="kp__field"><span>{t("live.wear")}</span><input type="number" min={selectedCatalog?.min_wear ?? 0} max={selectedCatalog?.max_wear ?? 1} step="0.000001" value={draft.wear} onChange={(event) => setDraft((value) => ({ ...value, wear: Math.min(selectedCatalog?.max_wear ?? 1, Math.max(selectedCatalog?.min_wear ?? 0, Number(event.target.value))) }))} /></label><label className="kp__field"><span>{t("live.seed")}</span><input type="number" min="0" max="1000" step="1" value={draft.seed} placeholder={t("live.seedPlaceholder")} onChange={(event) => setDraft((value) => ({ ...value, seed: Math.min(1000, Math.max(0, Number(event.target.value))) }))} /></label></div>
        <WearGauge min={selectedCatalog?.min_wear ?? 0} max={selectedCatalog?.max_wear ?? 1} value={draft.wear} />
        <label className="kp__field"><span>{t("live.nameTag")}</span><input maxLength={20} value={draft.name_tag} onChange={(event) => setDraft((value) => ({ ...value, name_tag: event.target.value }))} placeholder={t("cosmetics.namePlaceholder")} /></label>
        <div className="kp__toggle-row"><span>{team === "ct" ? t("cosmetics.defaultKnifeCt") : t("cosmetics.defaultKnifeT")}</span><Toggle checked={useAsDefault} onChange={setUseAsDefault} /></div>
        <div className="kp__toggle-row"><span>{t("live.stattrak")}</span><Toggle checked={draft.stattrak_enabled} disabled={!selectedCatalog?.stattrak} onChange={(enabled) => setDraft((value) => ({ ...value, stattrak_enabled: enabled }))} /></div>
        {draft.stattrak_enabled && <label className="kp__field"><span>{t("cosmetics.initialCount")}</span><input type="number" min="0" step="1" value={draft.stattrak_count} onChange={(event) => setDraft((value) => ({ ...value, stattrak_count: Math.max(0, Number(event.target.value)) }))} /></label>}
      </div>
      <div className="kp__main">
        <label className="kp__field"><span>{t("weapons.paint")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("cosmetics.searchSkin")} /></label>
        {skins.length ? <div className="kp__skins" ref={skinListRef}>{skins.map((skin) => {
          const details = catalog.get(`${skin.weapon_defindex}:${skin.paint}`);
          return (
            <button key={skin.paint} className={skin.paint === draft.paint ? "is-selected" : ""} onClick={() => choose(skin)}>
              {details?.stattrak && <span className="kp__badges" aria-hidden="true"><i className="is-st">ST</i></span>}
              <img src={skin.image} alt="" loading="lazy" />
              <span>{label(skin)}</span>
            </button>
          );
        })}</div> : <div className="wp-modal__empty">{t("weapons.noSkins")}</div>}
      </div>
    </div>
  </Modal>;
}
