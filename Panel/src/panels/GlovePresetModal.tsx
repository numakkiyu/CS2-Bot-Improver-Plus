import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import Toggle from "../components/Toggle";
import GLOVE_SKINS, { gloveModelName, type GloveSkin } from "../data/gloveSkins";
import { finishName, localizedSkinName } from "../data/skinLocalization";
import { api, type GlovePreset, type KnifeCustomizerConfig } from "../lib/api";
import { useT } from "../i18n";
import { useStore } from "../state/store";
import CosmeticsTeamSwitch, { useCosmeticsTeam } from "../components/CosmeticsTeamSwitch";
import "./KnifePresetModal.css";

const DEFAULT_GLOVE: GlovePreset = { enabled: false, defindex: 5030, paint: 10048, seed: 0, wear: 0.01 };
const rows = GLOVE_SKINS as GloveSkin[];

type Props = { open: boolean; csgoPath: string | null; config: KnifeCustomizerConfig | null; onSaved: (config: KnifeCustomizerConfig) => void; onError: (error: unknown) => void; onClose: () => void };

export default function GlovePresetModal({ open, csgoPath, config, onSaved, onError, onClose }: Props) {
  const t = useT();
  const { config: appConfig } = useStore();
  const language = appConfig?.language;
  const [draft, setDraft] = useState<GlovePreset>(DEFAULT_GLOVE);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [team, setTeam] = useCosmeticsTeam();
  const modelName = (defindex: number) => gloveModelName(language, defindex);
  const skinName = (skin: GloveSkin) => finishName(localizedSkinName(language, skin.defindex, skin.paint, `${modelName(skin.defindex)} | ${skin.name}`));

  useEffect(() => {
    if (!open || !config) return;
    const saved = config.loadouts[team].glove;
    setDraft(saved.defindex > 0 && saved.paint > 0
      ? { ...DEFAULT_GLOVE, ...saved }
      : { ...DEFAULT_GLOVE, enabled: saved.enabled });
    setQuery("");
  }, [open, team, config]);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return rows.filter((row) => !q || `${modelName(row.defindex)} ${skinName(row)} ${row.paint}`.toLocaleLowerCase().includes(q));
  // Labels follow the selected Panel language.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, query]);
  const selected = rows.find((row) => row.defindex === draft.defindex && row.paint === draft.paint);

  const save = async () => {
    if (!csgoPath || !config) return;
    setSaving(true);
    try {
      const state = await api.saveKnifeCustomizer(csgoPath, {
        ...config,
        enabled: true,
        loadouts: {
          ...config.loadouts,
          [team]: { ...config.loadouts[team], glove: draft },
        },
      });
      onSaved(state.config);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return <Modal open={open} title={t("cosmetics.gloveTitle")} onClose={onClose} width={440} footer={<button className="kp__save" disabled={saving || draft.paint <= 0} onClick={() => void save()}>{saving ? t("cosmetics.saving") : t("cosmetics.save")}</button>}>
    <div className="kp">
      <div className="kp__team-row"><span>{t("cosmetics.teamLoadout")}</span><CosmeticsTeamSwitch value={team} onChange={setTeam} ariaLabel={t("cosmetics.teamLoadout")} compact /></div>
      <div className="kp__preview"><img src={selected?.image} alt="" /><div><strong>{selected ? `${modelName(selected.defindex)} · ${skinName(selected)}` : t("cosmetics.chooseGlove")}</strong><span>{t("cosmetics.paintKit")} {draft.paint || "-"}</span></div></div>
      <div className="kp__toggle-row"><span>{team === "ct" ? t("cosmetics.enableGloveCt") : t("cosmetics.enableGloveT")}</span><Toggle checked={draft.enabled} onChange={(enabled) => setDraft((value) => ({ ...value, enabled }))} /></div>
      <label className="kp__field"><span>{t("cosmetics.gloveStyle")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("cosmetics.searchGlove")} /></label>
      <div className="kp__skins">{visible.map((skin) => <button key={`${skin.defindex}-${skin.paint}`} className={skin.defindex === draft.defindex && skin.paint === draft.paint ? "is-selected" : ""} onClick={() => setDraft((value) => ({ ...value, defindex: skin.defindex, paint: skin.paint, wear: Math.min(skin.maxWear, Math.max(skin.minWear, value.wear)) }))}><img src={skin.image} alt="" loading="lazy" /><span>{modelName(skin.defindex)} · {skinName(skin)} [{skin.paint}]</span></button>)}</div>
      <div className="kp__columns"><label className="kp__field"><span>{t("live.wear")}</span><input type="number" min={selected?.minWear ?? 0} max={selected?.maxWear ?? 1} step="0.000001" value={draft.wear} onChange={(event) => setDraft((value) => ({ ...value, wear: Math.min(selected?.maxWear ?? 1, Math.max(selected?.minWear ?? 0, Number(event.target.value))) }))} /></label><label className="kp__field"><span>{t("live.seed")}</span><input type="number" min="0" max="1000" step="1" value={draft.seed} onChange={(event) => setDraft((value) => ({ ...value, seed: Math.min(1000, Math.max(0, Number(event.target.value))) }))} /></label></div>
    </div>
  </Modal>;
}
