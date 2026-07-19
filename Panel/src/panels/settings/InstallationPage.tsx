import { useState } from "react";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArchiveRestore, CheckCircle2, CircleAlert, CircleX, ClipboardCheck, FileCheck2, FolderOpen, RefreshCw, Stethoscope, Trash2, Wrench } from "lucide-react";
import { useStore } from "../../state/store";
import { useT, type I18nKey } from "../../i18n";
import { useToast } from "../../components/Toast";
import { api, type InstallCheckReport, type InstallationSource, type MigrationKind } from "../../lib/api";
import Modal from "../../components/Modal";

const SOURCE_KEYS: Record<InstallationSource, I18nKey> = {
  clean: "install.source.clean",
  managed_plus: "install.source.managed_plus",
  legacy_plus: "install.source.legacy_plus",
  upstream: "install.source.upstream",
  mixed_unknown: "install.source.mixed_unknown",
};

const SOURCE_DESC_KEYS: Record<InstallationSource, I18nKey> = {
  clean: "install.sourceDesc.clean",
  managed_plus: "install.sourceDesc.managed_plus",
  legacy_plus: "install.sourceDesc.legacy_plus",
  upstream: "install.sourceDesc.upstream",
  mixed_unknown: "install.sourceDesc.mixed_unknown",
};

const ACTION_KEYS: Record<MigrationKind, I18nKey> = {
  fresh_install: "install.action.fresh_install",
  managed_upgrade: "install.action.managed_upgrade",
  adopt_legacy_plus: "install.action.adopt_legacy_plus",
  replace_upstream: "install.action.replace_upstream",
  blocked: "install.action.blocked",
};

export default function InstallationPage() {
  const {
    csgoPath, installation, process, verifyInstallation, installPayload, repairPayload,
    restorePayload, restorePristineCs2, exportDiagnostics, reportError,
  } = useStore();
  const t = useT();
  const toast = useToast();
  const [working, setWorking] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [diagnosticPath, setDiagnosticPath] = useState<string | null>(null);
  const [checks, setChecks] = useState<InstallCheckReport | null>(null);
  const [confirmAction, setConfirmAction] = useState<"restore" | "pristine" | null>(null);
  const damaged = (installation?.missing.length ?? 0) + (installation?.corrupt.length ?? 0);
  const blocked = !!process?.running && (process.matches_selected || !process.path_accessible);

  const run = async (name: string, action: () => Promise<unknown>) => {
    setWorking(name);
    try { await action(); }
    finally { setWorking(null); }
  };

  const restore = async () => {
    setConfirmAction(null);
    await run("restore", async () => {
      const result = await restorePayload();
      if (result) {
        setRestored(true);
        toast.show(t("install.restored"), "green");
      }
    });
  };

  const pristine = async () => {
    setConfirmAction(null);
    await run("pristine", async () => {
      const result = await restorePristineCs2();
      if (result) {
        setRestored(true);
        toast.show(t("install.pristineDone"), "green");
      }
    });
  };

  const diagnostics = async () => {
    await run("diagnostics", async () => {
      const result = await exportDiagnostics();
      if (!result) return;
      toast.show(t("install.exported", { path: result.path }), "green");
      try {
        await revealItemInDir(result.path);
        setDiagnosticPath(null);
      } catch {
        setDiagnosticPath(result.path);
      }
    });
  };

  const runChecks = async () => {
    if (!csgoPath) return;
    await run("checks", async () => {
      try { setChecks(await api.runInstallChecks(csgoPath)); }
      catch (error) { reportError(error); }
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
        {installation && (
          <div className={`install-source install-source--${installation.source}`}>
            <span><small>{t("install.source")}</small><strong>{t(SOURCE_KEYS[installation.source])}</strong></span>
            <p>{t(SOURCE_DESC_KEYS[installation.source])}</p>
          </div>
        )}
        {installation?.backup_path && (
          <button className="installation-path" onClick={() => open(installation.backup_path!)}>
            <FolderOpen size={16} /><span><small>{t("install.backup")}</small>{installation.backup_path}</span>
          </button>
        )}
      </section>

      <div className="installation-actions">
        <button className="is-primary" disabled={!csgoPath || !!working} onClick={runChecks}>
          <ClipboardCheck size={17} />{working === "checks" ? t("install.working") : t("install.runChecks")}
        </button>
        <button disabled={!csgoPath || !!working} onClick={() => run("verify", verifyInstallation)}>
          <RefreshCw size={17} />{working === "verify" ? t("install.working") : t("install.verify")}
        </button>
        {!installation?.installed && installation?.can_install && (
          <button className="is-primary" disabled={!csgoPath || blocked || !!working}
            onClick={() => run("install", installPayload)}>
            <FileCheck2 size={17} />{working === "install" ? t("install.working") : t(ACTION_KEYS[installation.migration_kind])}
          </button>
        )}
        {installation?.installed && (
          <button disabled={blocked || !!working} onClick={() => run("repair", repairPayload)}>
            <Wrench size={17} />{working === "repair" ? t("install.working") : t("install.repair")}
          </button>
        )}
        <button disabled={!installation?.restore_available || blocked || !!working} onClick={() => setConfirmAction("restore")}>
          <ArchiveRestore size={17} />{working === "restore" ? t("install.working") :
            t(installation?.restore_baseline === "pre_migration" ? "install.restorePrevious" : "install.restore")}
        </button>
        <button className="is-danger"
          disabled={!csgoPath || installation?.source === "clean" || blocked || !!working} onClick={() => setConfirmAction("pristine")}>
          <Trash2 size={17} />{working === "pristine" ? t("install.working") : t("install.pristine")}
        </button>
        <button disabled={!!working} onClick={diagnostics}>
          <Stethoscope size={17} />{working === "diagnostics" ? t("install.working") : t("install.diagnostics")}
        </button>
      </div>

      {checks && (
        <section className={`install-check-report report-${checks.overall}`}>
          <div className="install-check-summary">
            <span><ClipboardCheck size={18} /><strong>{t("install.checkReport")}</strong></span>
            <span className="install-check-counts"><b className="check-pass">{checks.pass_count} {t("install.pass")}</b><b className="check-warn">{checks.warn_count} {t("install.warn")}</b><b className="check-fail">{checks.fail_count} {t("install.fail")}</b></span>
          </div>
          <div className="install-check-list">
            {checks.checks.map((check) => {
              const Icon = check.status === "pass" ? CheckCircle2 : check.status === "warn" ? CircleAlert : CircleX;
              return <details className={`install-check check-${check.status}`} key={check.code} open={check.status === "fail"}>
                <summary><Icon size={16} /><span><strong>{check.title}</strong><small>{check.code}</small></span></summary>
                <div><p><b>{t("install.evidence")}</b>{check.evidence}</p><p><b>{t("install.cause")}</b>{check.cause}</p><p><b>{t("install.solution")}</b>{check.action}</p></div>
              </details>;
            })}
          </div>
        </section>
      )}

      {diagnosticPath && (
        <button className="installation-path" onClick={() => open(diagnosticPath.replace(/[\\/][^\\/]+$/, ""))}>
          <FolderOpen size={16} /><span><small>{t("install.openDiagnosticFolder")}</small>{diagnosticPath}</span>
        </button>
      )}

      {restored && (
        <button className="steam-verify" onClick={() => openUrl("steam://validate/730")}>
          {t("install.openSteamVerify")}
        </button>
      )}
      <Modal open={!!confirmAction} title={confirmAction === "pristine" ? t("install.pristine") : t("install.restore")} onClose={() => setConfirmAction(null)} footer={<><button className="install-confirm-cancel" onClick={() => setConfirmAction(null)}>{t("common.cancel")}</button><button className="install-confirm-accept" onClick={() => void (confirmAction === "pristine" ? pristine() : restore())}>{confirmAction === "pristine" ? t("install.pristine") : t("install.restore")}</button></>}>
        <p className="install-confirm-copy">{confirmAction === "pristine" ? t("install.confirmPristine") : t("install.confirmRestore")}</p>
      </Modal>
    </div>
  );
}
