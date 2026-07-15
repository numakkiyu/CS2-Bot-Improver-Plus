import { useEffect, useState } from "react";
import SubPage from "../components/SubPage";
import { useT } from "../i18n";
import { api, type KnifeCustomizerConfig } from "../lib/api";
import { useStore } from "../state/store";
import { WEAPON_ICONS, type WeaponIcon } from "../data/weaponIcons";
import WeaponPresetModal from "./WeaponPresetModal";
import MusicKitPresetModal from "./MusicKitPresetModal";
import { MUSIC_KITS, musicKitName } from "../data/musicKits";
import CosmeticsTeamSwitch, { useCosmeticsTeam } from "../components/CosmeticsTeamSwitch";
import "./WeaponPresetsPanel.css";

export default function WeaponPresetsPanel({ onBack }: { onBack?: () => void }) {
  const t = useT();
  const { csgoPath, reportError, config: appConfig } = useStore();
  const [config, setConfig] = useState<KnifeCustomizerConfig | null>(null);
  const [editing, setEditing] = useState<WeaponIcon | null>(null);
  const [editingMusicKit, setEditingMusicKit] = useState(false);
  const [team, setTeam] = useCosmeticsTeam();

  useEffect(() => {
    if (!csgoPath) return setConfig(null);
    api.getKnifeCustomizer(csgoPath).then((state) => setConfig(state.config)).catch(reportError);
  }, [csgoPath, reportError]);

  const teamWeapons = WEAPON_ICONS.filter((weapon) => weapon.availability === team || weapon.availability === "shared");
  const exclusiveWeapons = teamWeapons.filter((weapon) => weapon.availability === team);
  const sharedWeapons = teamWeapons.filter((weapon) => weapon.availability === "shared");
  const presets = config?.loadouts?.[team]?.gun_presets ?? {};
  const count = teamWeapons.filter((weapon) => !!presets[String(weapon.id)]).length;
  const selectedMusicKit = MUSIC_KITS.find((kit) => kit.def_index === (config?.music_kit_id ?? 0));
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

  return <SubPage title={t("weapons.title")} onBack={onBack} right={<span className="wp__summary">{count} / {teamWeapons.length}</span>}>
    <div className="wp__team-bar">
      <div><small>{t("weapons.teamLoadout")}</small><strong>{team === "ct" ? t("weapons.ctLoadout") : t("weapons.tLoadout")}</strong></div>
      <CosmeticsTeamSwitch value={team} onChange={setTeam} ariaLabel={t("weapons.teamLoadout")} compact />
    </div>
    <button className={`wp__music ${selectedMusicKit ? "is-configured" : ""}`} onClick={() => setEditingMusicKit(true)}>
      <span className="wp__music-art">{selectedMusicKit ? <img src={selectedMusicKit.image} alt="" /> : <span>Steam</span>}</span>
      <span className="wp__music-copy"><small>{t("music.title")}</small><strong>{selectedMusicKit ? musicKitName(selectedMusicKit, appConfig?.language) : t("music.default")}</strong><em>{selectedMusicKit ? t("music.configured") : t("music.select")}</em></span>
      <span className="wp__music-action">›</span>
    </button>
    <section className="wp__group"><h2>{team === "ct" ? t("weapons.ctExclusive") : t("weapons.tExclusive")}</h2>{weaponGrid(exclusiveWeapons)}</section>
    <section className="wp__group"><h2>{t("weapons.shared")}</h2>{weaponGrid(sharedWeapons)}</section>
    <MusicKitPresetModal open={editingMusicKit} csgoPath={csgoPath} config={config} onSaved={setConfig} onError={reportError} onClose={() => setEditingMusicKit(false)} />
    <WeaponPresetModal weapon={editing} team={team} csgoPath={csgoPath} config={config} onSaved={setConfig} onError={reportError} onClose={() => setEditing(null)} />
  </SubPage>;
}
