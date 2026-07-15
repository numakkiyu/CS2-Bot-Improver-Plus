import { useState } from "react";
import { BackIcon, ChevronRight } from "../../components/icons";
import DevsPage from "./DevsPage";
import LanguagesPage from "./LanguagesPage";
import DirectoryPage from "./DirectoryPage";
import InstallationPage from "./InstallationPage";
import { useT, type I18nKey } from "../../i18n";
import "./settings.css";

type Page = "root" | "devs" | "languages" | "directory" | "installation";

const TITLE_KEYS: Record<Page, I18nKey> = {
  root: "set.title",
  devs: "set.devs",
  languages: "set.languages",
  directory: "set.directory",
  installation: "set.installation",
};

export default function SettingsView({ onClose }: { onClose?: () => void }) {
  const [page, setPage] = useState<Page>("root");
  const t = useT();
  const back = () => (page === "root" ? onClose?.() : setPage("root"));

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
          <div className="settings-list">
            {(["installation", "directory", "languages", "devs"] as const).map((p) => (
              <button key={p} className="settings-row settings-row--nav" onClick={() => setPage(p)}>
                <span className="settings-row__title">{t(TITLE_KEYS[p])}</span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        )}
        {page === "devs" && <DevsPage />}
        {page === "languages" && <LanguagesPage />}
        {page === "directory" && <DirectoryPage />}
        {page === "installation" && <InstallationPage />}
      </div>
    </div>
  );
}
