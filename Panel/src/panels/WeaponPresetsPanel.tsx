import { useEffect, useState } from "react";
import SubPage from "../components/SubPage";
import { useT } from "../i18n";
import { api, type KnifeCustomizerConfig } from "../lib/api";
import { useStore } from "../state/store";
import { WEAPON_ICONS, type WeaponIcon } from "../data/weaponIcons";
import WeaponPresetModal from "./WeaponPresetModal";
import MusicKitPresetModal from "./MusicKitPresetModal";
import { MUSIC_KITS, musicKitName } from "../data/musicKits";
import "./WeaponPresetsPanel.css";

export default function WeaponPresetsPanel({ onBack }: { onBack?: () => void }) {
  const t = useT();
  const { csgoPath, reportError, config: appConfig } = useStore();
  const [config, setConfig] = useState<KnifeCustomizerConfig | null>(null);
  const [editing, setEditing] = useState<WeaponIcon | null>(null);
  const [editingMusicKit, setEditingMusicKit] = useState(false);

  useEffect(() => {
    if (!csgoPath) return setConfig(null);
    api.getKnifeCustomizer(csgoPath).then((state) => setConfig(state.config)).catch(reportError);
  }, [csgoPath, reportError]);

  const count = Object.keys(config?.gun_presets ?? {}).length;
  const selectedMusicKit = MUSIC_KITS.find((kit) => kit.def_index === (config?.music_kit_id ?? 0));
  return <SubPage title={t("weapons.title")} onBack={onBack} right={<span className="wp__summary">{count} / {WEAPON_ICONS.length}</span>}>
    <button className={`wp__music ${selectedMusicKit ? "is-configured" : ""}`} onClick={() => setEditingMusicKit(true)}>
      <span className="wp__music-art">{selectedMusicKit ? <img src={selectedMusicKit.image} alt="" /> : <span>Steam</span>}</span>
      <span className="wp__music-copy"><small>{t("music.title")}</small><strong>{selectedMusicKit ? musicKitName(selectedMusicKit, appConfig?.language) : t("music.default")}</strong><em>{selectedMusicKit ? t("music.configured") : t("music.select")}</em></span>
      <span className="wp__music-action">›</span>
    </button>
    <div className="wp__grid">
      {WEAPON_ICONS.map((weapon) => {
        const configured = !!config?.gun_presets?.[String(weapon.id)];
        return <button key={weapon.id} className={`wp__weapon ${configured ? "is-configured" : ""}`} onClick={() => setEditing(weapon)} title={`${weapon.name} · ${configured ? t("weapons.configured") : t("weapons.unconfigured")}`}>
          {configured && <i className="wp__dot" />}
          <img src={weapon.url} alt="" draggable={false} />
          <span>{weapon.name}</span>
        </button>;
      })}
    </div>
    <MusicKitPresetModal open={editingMusicKit} csgoPath={csgoPath} config={config} onSaved={setConfig} onError={reportError} onClose={() => setEditingMusicKit(false)} />
    <WeaponPresetModal weapon={editing} csgoPath={csgoPath} config={config} onSaved={setConfig} onError={reportError} onClose={() => setEditing(null)} />
  </SubPage>;
}
