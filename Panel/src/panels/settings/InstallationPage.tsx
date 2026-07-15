import { useState } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { ArchiveRestore, FileCheck2, FolderOpen, RefreshCw, Stethoscope, Wrench } from "lucide-react";
import { useStore } from "../../state/store";
import { useT } from "../../i18n";
import { useToast } from "../../components/Toast";

export default function InstallationPage() {
  const {
    csgoPath, installation, process, verifyInstallation, installPayload, repairPayload,
    restorePayload, exportDiagnostics, reportError,
  } = useStore();
  const t = useT();
  const toast = useToast();
  const [working, setWorking] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const damaged = (installation?.missing.length ?? 0) + (installation?.corrupt.length ?? 0);
  const blocked = !!process?.running && (process.matches_selected || !process.path_accessible);

  const run = async (name: string, action: () => Promise<unknown>) => {
    setWorking(name);
    try { await action(); }
    finally { setWorking(null); }
  };

  const restore = async () => {
    if (!window.confirm(t("install.confirmRestore"))) return;
    await run("restore", async () => {
      const result = await restorePayload();
      if (result) {
        setRestored(true);
        toast.show(t("install.restored"), "green");
      }
    });
  };

  const diagnostics = async () => {
    await run("diagnostics", async () => {
      const result = await exportDiagnostics();
      if (result) toast.show(t("install.exported", { path: result.path }), "green");
    });
  };

  const open = async (path: string) => {
    try { await openPath(path); } catch (error) { reportError(error); }
  };

  return (
    <div className="installation-page">
      <section className="installation-status">
        <div className="installation-status__head">
          <FileCheck2 size={19} />
          <span><strong>{t("install.status")}</strong><small>{csgoPath ?? t("set.noCsgo")}</small></span>
        </div>
        {!installation?.installed ? (
          <p>{t("install.notInstalled")}</p>
        ) : (
          <div className="installation-facts">
            <span>{t("install.version")} <strong>{installation.package_version}</strong></span>
            <span className={damaged ? "is-warning" : "is-healthy"}>
              {damaged ? t("install.damaged", { n: damaged }) : t("install.healthy", { n: installation.total })}
            </span>
          </div>
        )}
        {installation?.backup_path && (
          <button className="installation-path" onClick={() => open(installation.backup_path!)}>
            <FolderOpen size={16} /><span><small>{t("install.backup")}</small>{installation.backup_path}</span>
          </button>
        )}
      </section>

      <div className="installation-actions">
        <button disabled={!csgoPath || !!working} onClick={() => run("verify", verifyInstallation)}>
          <RefreshCw size={17} />{working === "verify" ? t("install.working") : t("install.verify")}
        </button>
        {!installation?.installed && (
          <button className="is-primary" disabled={!csgoPath || blocked || !!working}
            onClick={() => run("install", installPayload)}>
            <FileCheck2 size={17} />{working === "install" ? t("install.working") : t("install.install")}
          </button>
        )}
        {installation?.installed && (
          <button disabled={blocked || !!working} onClick={() => run("repair", repairPayload)}>
            <Wrench size={17} />{working === "repair" ? t("install.working") : t("install.repair")}
          </button>
        )}
        <button disabled={!installation?.installed || blocked || !!working} onClick={restore}>
          <ArchiveRestore size={17} />{working === "restore" ? t("install.working") : t("install.restore")}
        </button>
        <button disabled={!!working} onClick={diagnostics}>
          <Stethoscope size={17} />{working === "diagnostics" ? t("install.working") : t("install.diagnostics")}
        </button>
      </div>

      {restored && (
        <button className="steam-verify" onClick={() => openUrl("steam://validate/730")}>
          {t("install.openSteamVerify")}
        </button>
      )}
    </div>
  );
}
