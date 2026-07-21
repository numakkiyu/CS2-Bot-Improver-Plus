import { useEffect, useRef, useState } from "react";
import { Crosshair, Gem, Swords } from "lucide-react";
import SubPage from "../components/SubPage";
import { useT } from "../i18n";
import { api, type KnifeCustomizerConfig } from "../lib/api";
import { useStore } from "../state/store";
import { WEAPON_ICONS, type WeaponIcon } from "../data/weaponIcons";
import { KNIFE_ICONS, type KnifeIcon } from "../data/knifeIcons";
import { itemName, localizedSkinName } from "../data/skinLocalization";
import { captureKeyName } from "../lib/keycapture";
import WeaponPresetModal from "./WeaponPresetModal";
import KnifePresetModal from "./KnifePresetModal";
import GlovePresetModal from "./GlovePresetModal";
import MusicKitPresetModal from "./MusicKitPresetModal";
import { MUSIC_KITS, musicKitName } from "../data/musicKits";
import CosmeticsTeamSwitch, { useCosmeticsTeam } from "../components/CosmeticsTeamSwitch";
import CosmeticsPresetActions from "../components/CosmeticsPresetActions";
import type { Status } from "../components/StatusDot";
import "./WeaponPresetsPanel.css";

export default function WeaponPresetsPanel({ onBack }: { onBack?: () => void }) {
  const t = useT();
  const { csgoPath, reportError, config: appConfig, dropKnives, applyDropKnives, dropKnivesPending } = useStore();
  const [config, setConfig] = useState<KnifeCustomizerConfig | null>(null);
  const [editing, setEditing] = useState<WeaponIcon | null>(null);
  const [editingKnife, setEditingKnife] = useState<KnifeIcon | null>(null);
  const [editingGlove, setEditingGlove] = useState(false);
  const [editingMusicKit, setEditingMusicKit] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [dropDraft, setDropDraft] = useState<number[]>([]);
  const dropSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [team, setTeam] = useCosmeticsTeam();

  useEffect(() => {
    if (!csgoPath) return setConfig(null);
    api.getKnifeCustomizer(csgoPath).then((state) => setConfig(state.config)).catch(reportError);
  }, [csgoPath, reportError]);

  useEffect(() => {
    setDropDraft(dropKnives?.selected ?? []);
  }, [dropKnives?.selected]);

  const teamWeapons = WEAPON_ICONS.filter((weapon) => weapon.availability === team || weapon.availability === "shared");
  const exclusiveWeapons = teamWeapons.filter((weapon) => weapon.availability === team);
  const sharedWeapons = teamWeapons.filter((weapon) => weapon.availability === "shared");
  const presets = config?.loadouts?.[team]?.gun_presets ?? {};
  const count = teamWeapons.filter((weapon) => !!presets[String(weapon.id)]).length;
  const selectedMusicKit = MUSIC_KITS.find((kit) => kit.def_index === (config?.music_kit_id ?? 0));

  const bindKey = dropKnives?.bind_key ?? "\\";
  const dropSelected = new Set(dropDraft);
  const cfgPresent = dropKnives?.cfg_present ?? false;
  const running = dropKnives?.cs2_running ?? false;
  const bindDisabled = !csgoPath || !cfgPresent;
  const cosmeticsDisabled = !csgoPath;
  const ctLoadout = config?.loadouts?.ct;
  const tLoadout = config?.loadouts?.t;

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
      dropSaveQueue.current = dropSaveQueue.current.then(() => applyDropKnives(name, Array.from(dropSelected)));
    };
    window.addEventListener("keydown", onKey, { capture: true, once: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const toggleDrop = (id: number) => {
    if (bindDisabled) return;
    const next = new Set(dropSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // keep numeric order for a stable bind string
    const ordered = KNIFE_ICONS.map((k) => k.id).filter((i) => next.has(i));
    setDropDraft(ordered);
    dropSaveQueue.current = dropSaveQueue.current.then(() => applyDropKnives(bindKey, ordered));
  };

  const weaponGrid = (weapons: WeaponIcon[]) => <div className="wp__grid">
    {weapons.map((weapon) => {
      const configured = !!presets[String(weapon.id)];
      return <button key={weapon.id} className={`wp__weapon ${configured ? "is-configured" : ""}`} onClick={() => setEditing(weapon)} title={`${weapon.name} · ${configured ? t("weapons.configured") : t("weapons.unconfigured")}`}>
        {configured && <i className="wp__dot" />}
        <img src={weapon.url} alt="" draggable={false} />
        <span>{weapon.name}</span>
      </button>;
    })}
  </div>;

  return <SubPage title={t("weapons.title")} onBack={onBack} status={status} right={<CosmeticsPresetActions csgoPath={csgoPath} onImported={setConfig} onError={reportError} />}>
    <section className="cos-card">
      <header className="cos-card__head">
        <span className="cos-card__icon cos-card__icon--weapons" aria-hidden="true"><Crosshair size={18} /></span>
        <span className="cos-card__title">
          <strong>{t("cosmetics.sectionWeapons")}</strong>
          <small>{team === "ct" ? t("weapons.ctLoadout") : t("weapons.tLoadout")} · {count} / {teamWeapons.length}</small>
        </span>
        <CosmeticsTeamSwitch value={team} onChange={setTeam} ariaLabel={t("weapons.teamLoadout")} compact />
      </header>
      <div className="cos-card__body">
        <div className="wp__sub"><h3>{team === "ct" ? t("weapons.ctExclusive") : t("weapons.tExclusive")}</h3>{weaponGrid(exclusiveWeapons)}</div>
        <div className="wp__sub"><h3>{t("weapons.shared")}</h3>{weaponGrid(sharedWeapons)}</div>
      </div>
    </section>

    <section className="cos-card">
      <header className="cos-card__head">
        <span className="cos-card__icon cos-card__icon--knives" aria-hidden="true"><Swords size={18} /></span>
        <span className="cos-card__title">
          <strong>{t("pre.dropKnives")}</strong>
          <small>{t("cosmetics.dropCount", { n: dropSelected.size })}</small>
        </span>
        <span className="wp__bind">
          <small className="wp__bind-hint">{t("cosmetics.leftRight")}</small>
          <span className="wp__bind-label">{t("pre.bind")}</span>
          <button
            className={`wp__bind-box ${capturing ? "is-capturing" : ""}`}
            disabled={bindDisabled}
            onClick={() => setCapturing(true)}
            title={t("cosmetics.keyHint")}
          >
            {capturing ? t("pre.pressKey") : bindKey}
          </button>
        </span>
      </header>
      <div className="cos-card__body">
        <div className="wp__grid">
          {KNIFE_ICONS.map((knife) => {
            const name = itemName(localizedSkinName(appConfig?.language, knife.id, 0, `Knife ${knife.id}`));
            const isDrop = dropSelected.has(knife.id);
            const hasCt = ctLoadout?.default_knife_defindex === knife.id;
            const hasT = tLoadout?.default_knife_defindex === knife.id;
            return (
              <button
                key={knife.id}
                className={`wp__weapon wp__knife ${isDrop ? "is-drop" : ""} ${hasCt || hasT ? "is-configured" : ""}`}
                onClick={() => toggleDrop(knife.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!cosmeticsDisabled) setEditingKnife(knife);
                }}
                disabled={cosmeticsDisabled}
                title={`${name} · ${t("cosmetics.leftRight")}`}
                aria-pressed={isDrop}
              >
                {(hasCt || hasT) && <span className="wp__team-tags" aria-hidden="true">
                  {hasCt && <i className="is-ct">CT</i>}
                  {hasT && <i className="is-t">T</i>}
                </span>}
                {isDrop && <i className="wp__drop-check" aria-hidden="true">✓</i>}
                <img src={knife.url} alt={name} draggable={false} />
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>

    <section className="cos-card">
      <header className="cos-card__head">
        <span className="cos-card__icon cos-card__icon--gear" aria-hidden="true"><Gem size={18} /></span>
        <span className="cos-card__title">
          <strong>{t("cosmetics.sectionGear")}</strong>
          <small>{t("music.title")} · {t("cosmetics.playerGloves")}</small>
        </span>
      </header>
      <div className="cos-card__body cos-card__body--rows">
        <button className={`wp__music ${selectedMusicKit ? "is-configured" : ""}`} onClick={() => setEditingMusicKit(true)}>
          <span className="wp__music-art">{selectedMusicKit ? <img src={selectedMusicKit.image} alt="" /> : <span>Steam</span>}</span>
          <span className="wp__music-copy"><small>{t("music.title")}</small><strong>{selectedMusicKit ? musicKitName(selectedMusicKit, appConfig?.language) : t("music.default")}</strong><em>{selectedMusicKit ? t("music.configured") : t("music.select")}</em></span>
          <span className="wp__music-action">›</span>
        </button>
        <button
          className={`wp__music wp__glove ${ctLoadout?.glove?.enabled || tLoadout?.glove?.enabled ? "is-configured" : ""}`}
          disabled={cosmeticsDisabled}
          onClick={() => setEditingGlove(true)}
          title={t("cosmetics.gloveOpen")}
        >
          <span className="wp__music-copy wp__glove-copy">
            <small>{t("cosmetics.playerGloves")}</small>
            <strong><i className="wp-modal__team wp-modal__team--ct">CT</i> {ctLoadout?.glove?.enabled ? `${t("cosmetics.enabled")} · ${ctLoadout.glove.paint}` : t("cosmetics.disabled")}</strong>
            <strong><i className="wp-modal__team wp-modal__team--t">T</i> {tLoadout?.glove?.enabled ? `${t("cosmetics.enabled")} · ${tLoadout.glove.paint}` : t("cosmetics.disabled")}</strong>
          </span>
          <span className="wp__music-action">›</span>
        </button>
      </div>
    </section>

    <MusicKitPresetModal open={editingMusicKit} csgoPath={csgoPath} config={config} onSaved={setConfig} onError={reportError} onClose={() => setEditingMusicKit(false)} />
    <WeaponPresetModal weapon={editing} team={team} csgoPath={csgoPath} config={config} onSaved={setConfig} onError={reportError} onClose={() => setEditing(null)} />
    <KnifePresetModal knife={editingKnife} csgoPath={csgoPath} config={config} onSaved={setConfig} onError={reportError} onClose={() => setEditingKnife(null)} />
    <GlovePresetModal open={editingGlove} csgoPath={csgoPath} config={config} onSaved={setConfig} onError={reportError} onClose={() => setEditingGlove(false)} />
  </SubPage>;
}
