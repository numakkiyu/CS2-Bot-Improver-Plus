import { useEffect, useState } from "react";
import { Code2, Download, FileCheck2, FlaskConical, FolderOpen, Info, Languages, type LucideIcon } from "lucide-react";
import { BackIcon, ChevronRight } from "../../components/icons";
import DevsPage from "./DevsPage";
import LanguagesPage from "./LanguagesPage";
import DirectoryPage from "./DirectoryPage";
import InstallationPage from "./InstallationPage";
import OnlineUpdatePage from "./OnlineUpdatePage";
import ExperimentalPage from "./ExperimentalPage";
import { api, type OnlineUpdateSnapshot } from "../../lib/api";
import { useStore } from "../../state/store";
import { LANGUAGES } from "../../data/languages";
import { useT, type I18nKey } from "../../i18n";
import "./settings.css";

type Page = "root" | "devs" | "languages" | "directory" | "installation" | "updates" | "experimental";

const TITLE_KEYS: Record<Page, I18nKey> = {
  root: "set.title",
  devs: "set.devs",
  languages: "set.languages",
  directory: "set.directory",
  installation: "set.installation",
  updates: "set.updates",
  experimental: "experimental.title",
};

const DESC_KEYS: Record<Exclude<Page, "root">, I18nKey> = {
  updates: "set.updatesDesc",
  installation: "set.installationDesc",
  directory: "set.directoryDesc",
  languages: "set.languagesDesc",
  devs: "set.devsDesc",
  experimental: "experimental.settingsDesc",
};

const ICONS: Record<Exclude<Page, "root">, LucideIcon> = {
  updates: Download,
  installation: FileCheck2,
  directory: FolderOpen,
  languages: Languages,
  devs: Code2,
  experimental: FlaskConical,
};

type Tone = "green" | "yellow" | "blue" | "neutral";

export default function SettingsView({ onClose }: { onClose?: () => void }) {
  const [page, setPage] = useState<Page>("root");
  const { config, directory, installation } = useStore();
  const [updates, setUpdates] = useState<OnlineUpdateSnapshot | null>(null);
  const t = useT();
  const back = () => (page === "root" ? onClose?.() : setPage("root"));

  useEffect(() => {
    if (page !== "root") return;
    void api.getUpdateSnapshot().then(setUpdates).catch(() => {});
  }, [page]);

  const updateAvailable = !!updates && (updates.panel.update_available || updates.plugin.update_available);
  const language = LANGUAGES.find((entry) => entry.code === config?.language);

  const STATUS: Record<Exclude<Page, "root">, { text: string; tone: Tone } | null> = {
    updates: updates
      ? { text: t(updateAvailable ? "update.available" : "update.current"), tone: updateAvailable ? "yellow" : "green" }
      : null,
    installation: installation?.installed
      ? { text: `v${installation.package_version}`, tone: installation.missing.length + installation.corrupt.length > 0 ? "yellow" : "green" }
      : { text: t("install.notInstalled"), tone: "neutral" },
    directory: directory?.valid && directory.selected
      ? { text: directory.selected, tone: "blue" }
      : { text: t("set.noCsgo"), tone: "yellow" },
    languages: language ? { text: language.native, tone: "blue" } : null,
    devs: null,
    experimental: config?.experimental_features_enabled
      ? { text: t("cosmetics.enabled"), tone: "yellow" }
      : { text: t("cosmetics.disabled"), tone: "neutral" },
  };

  return (
    <div className="settings">
      <div className="settings__head">
        {(page !== "root" || onClose) && (
          <button className="settings__back" onClick={back} aria-label="Back">
            <BackIcon size={20} />
          </button>
        )}
        <span className="settings__title">{t(TITLE_KEYS[page])}</span>
      </div>

      <div className="settings__body">
        {page === "root" && (
          <>
            <div className="settings-list">
              {(["updates", "installation", "directory", "languages", "experimental", "devs"] as const).map((p) => {
                const Icon = ICONS[p];
                const status = STATUS[p];
                return (
                  <button key={p} className="set-card" onClick={() => setPage(p)}>
                    <span className={`set-card__icon set-card__icon--${p}`} aria-hidden="true">
                      <Icon size={20} strokeWidth={1.9} />
                    </span>
                    <span className="set-card__body">
                      <strong>{t(TITLE_KEYS[p])}</strong>
                      <small>{t(DESC_KEYS[p])}</small>
                      {status && <em className={`set-card__status is-${status.tone}`}>{status.text}</em>}
                    </span>
                    <ChevronRight size={18} className="set-card__chevron" />
                  </button>
                );
              })}
            </div>
            <aside className="set-disclaimer">
              <span className="set-disclaimer__icon" aria-hidden="true"><Info size={17} /></span>
              <span className="set-disclaimer__body">
                <strong>{t("set.disclaimerTitle")}</strong>
                <p>{t("set.disclaimerBody")}</p>
              </span>
            </aside>
          </>
        )}
        {page === "devs" && <DevsPage />}
        {page === "languages" && <LanguagesPage />}
        {page === "directory" && <DirectoryPage />}
        {page === "installation" && <InstallationPage />}
        {page === "updates" && <OnlineUpdatePage />}
        {page === "experimental" && <ExperimentalPage />}
      </div>
    </div>
  );
}
