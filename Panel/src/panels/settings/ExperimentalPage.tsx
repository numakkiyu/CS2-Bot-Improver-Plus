import { useEffect, useState } from "react";
import { Link2, Sticker } from "lucide-react";
import Toggle from "../../components/Toggle";
import { api, type KnifeCustomizerConfig } from "../../lib/api";
import { useStore } from "../../state/store";
import { useT } from "../../i18n";

export default function ExperimentalPage() {
  const { config, updateConfig, csgoPath, process, reportError } = useStore();
  const [cosmetics, setCosmetics] = useState<KnifeCustomizerConfig | null>(null);
  const [working, setWorking] = useState(false);
  const t = useT();
  const running = !!process?.running;
  const master = !!config?.experimental_features_enabled;
  const stickerPreference = !!config?.experimental_stickers_enabled;

  useEffect(() => {
    if (!csgoPath) return setCosmetics(null);
    void api.getKnifeCustomizer(csgoPath).then((state) => setCosmetics(state.config)).catch(reportError);
  }, [csgoPath, reportError]);

  const persist = async (nextMaster: boolean, nextStickers: boolean) => {
    if (working || running) return;
    setWorking(true);
    const previousCosmetics = cosmetics;
    try {
      if (csgoPath && cosmetics) {
        const state = await api.saveKnifeCustomizer(csgoPath, {
          ...cosmetics,
          stickers_enabled: nextMaster && nextStickers,
        });
        setCosmetics(state.config);
      }
      const saved = await updateConfig({
        experimental_features_enabled: nextMaster,
        experimental_stickers_enabled: nextStickers,
      });
      if (!saved && csgoPath && previousCosmetics) {
        const restored = await api.saveKnifeCustomizer(csgoPath, previousCosmetics);
        setCosmetics(restored.config);
      }
    } catch (error) {
      reportError(error);
    } finally {
      setWorking(false);
    }
  };

  return <div className="experimental-page">
    <section className="experimental-master">
      <span>
        <strong>{t("experimental.master")}</strong>
        <small>{t("experimental.masterDesc")}</small>
      </span>
      <Toggle
        checked={master}
        disabled={working || running}
        onChange={(next) => void persist(next, next ? true : stickerPreference)}
        ariaLabel={t("experimental.master")}
      />
    </section>

    <div className="experimental-features">
      <section className={!master ? "is-locked" : ""}>
        <i><Sticker size={20} /></i>
        <span><strong>{t("stickers.title")}</strong><small>{t("experimental.stickersDesc")}</small></span>
        <Toggle
          checked={master && stickerPreference}
          disabled={!master || working || running || !csgoPath}
          onChange={(next) => void persist(master, next)}
          ariaLabel={t("stickers.title")}
        />
      </section>
      <section className="is-locked">
        <i><Link2 size={20} /></i>
        <span><strong>{t("experimental.keychains")}</strong><small>{t("experimental.keychainsDesc")}</small></span>
        <Toggle checked={false} disabled ariaLabel={t("experimental.keychains")} />
      </section>
    </div>

    {running && <div className="experimental-running">{t("experimental.closeCs2")}</div>}
  </div>;
}
