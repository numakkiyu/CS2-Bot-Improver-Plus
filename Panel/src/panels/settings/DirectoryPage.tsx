import { useStore } from "../../state/store";
import { useT } from "../../i18n";
import StatusDot from "../../components/StatusDot";
import { openDialog } from "../../lib/platform";
import { Check, FolderOpen } from "lucide-react";

export default function DirectoryPage() {
  const { directory, chooseDirectory, reportError } = useStore();
  const t = useT();
  const candidates = directory?.candidates ?? [];
  const selected = directory?.selected ?? null;
  const alternatives = candidates.filter((path) => path !== selected);

  const browse = async () => {
    try {
      const picked = await openDialog({ directory: true, title: "Select game/csgo folder" });
      if (typeof picked === "string") await chooseDirectory(picked);
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className="directory-page">
      {!directory?.steam_found && (
        <div className="dir-note">{t("set.steamNotDetected")}</div>
      )}

      <section className="directory-panel">
        <div className="directory-current">
          <span className="directory-current__status" aria-hidden="true">
            <FolderOpen size={19} strokeWidth={1.9} />
          </span>
          <span className="directory-current__body">
            <span className="directory-current__label">
              {t("set.currentDirectory")}
              <StatusDot status={directory?.valid && selected ? "green" : "off"} />
            </span>
            <code>{selected ?? t("set.noCsgo")}</code>
          </span>
          <button className="directory-browse" onClick={browse}>
            <FolderOpen size={16} strokeWidth={1.9} />
            <span>{t("set.browse")}</span>
          </button>
        </div>

        {alternatives.length > 0 && (
          <div className="directory-options">
            <span className="directory-options__label">{t("set.detectedDirectories")}</span>
            {alternatives.map((path) => (
              <button className="directory-option" key={path} onClick={() => chooseDirectory(path)}>
                <code>{path}</code>
                <Check size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
