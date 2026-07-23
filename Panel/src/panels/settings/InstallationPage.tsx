import { useState } from "react";
import { ArchiveRestore, CheckCircle2, CircleAlert, CircleX, ClipboardCheck, Copy, FileCheck2, FolderOpen, RefreshCw, Stethoscope, Trash2, Wrench } from "lucide-react";
import { useStore } from "../../state/store";
import { useT, type I18nKey } from "../../i18n";
import { useToast } from "../../components/Toast";
import { api, type InstallCheckReport, type InstallationSource, type MigrationKind } from "../../lib/api";
import { localizeInstallCheck } from "../../lib/installCheckLocalization";
import Modal from "../../components/Modal";
import { openExternalPath, openExternalUrl, writeClipboard } from "../../lib/platform";

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

type HeroTone = "blue" | "green" | "yellow" | "red";

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

  const source = installation?.source ?? "clean";
  const tone: HeroTone = !installation?.installed
    ? "blue"
    : source === "managed_plus"
      ? (damaged ? "yellow" : "green")
      : source === "mixed_unknown"
        ? "red"
        : source === "legacy_plus" || source === "upstream"
          ? "yellow"
          : "blue";

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
      if (!result) {
        toast.show(t("err.exportFailed"), "red");
        return;
      }
      setDiagnosticPath(result.path);
    });
  };

  const copyDiagnosticPath = async () => {
    if (!diagnosticPath) return;
    try {
      await writeClipboard(diagnosticPath);
      toast.show(t("common.copied"), "green");
    } catch {
      toast.show(t("common.copyFailed"), "red");
    }
  };

  const runChecks = async () => {
    if (!csgoPath) return;
    await run("checks", async () => {
      try { setChecks(await api.runInstallChecks(csgoPath)); }
      catch (error) { reportError(error); }
    });
  };

  const preflightAndRun = async (
    name: "install" | "repair",
    action: () => Promise<unknown>
  ) => {
    if (!csgoPath) return;
    await run(name, async () => {
      try {
        const report = await api.runInstallChecks(csgoPath);
        setChecks(report);
        if (!report.can_proceed) {
          toast.show(t("install.action.blocked"), "red");
          return;
        }
        await action();
      } catch (error) {
        reportError(error);
      }
    });
  };

  const open = async (path: string) => {
    try { await openExternalPath(path); } catch (error) { reportError(error); }
  };

  return (
    <div className="installation-page">
      <section className={`inst-hero inst-hero--${tone}`}>
        <span className="inst-hero__icon" aria-hidden="true"><FileCheck2 size={22} /></span>
        <div className="inst-hero__main">
          <small>{t("install.status")}</small>
          <strong>{installation?.installed ? t(SOURCE_KEYS[source]) : t("install.notInstalled")}</strong>
          <span className="inst-hero__path">{csgoPath ?? t("set.noCsgo")}</span>
          {installation && <p>{t(SOURCE_DESC_KEYS[source])}</p>}
        </div>
        <div className="inst-hero__side">
          {installation?.installed && (
            <>
              <span className="inst-hero__fact">
                <small>{t("install.version")}</small>
                <strong>{installation.package_version}</strong>
              </span>
              <span className={`inst-hero__fact ${damaged ? "is-warning" : "is-healthy"}`}>
                <small>{t("st.files")}</small>
                <strong>{damaged ? t("install.damaged", { n: damaged }) : t("install.healthy", { n: installation.total })}</strong>
              </span>
            </>
          )}
          {installation?.backup_path && (
            <button className="inst-hero__backup" onClick={() => open(installation.backup_path!)} title={installation.backup_path}>
              <FolderOpen size={14} />
              <span><small>{t("install.backup")}</small>{installation.backup_path}</span>
            </button>
          )}
        </div>
      </section>

      <div className="inst-groups">
        <section className="inst-group">
          <header className="inst-group__head">
            <ClipboardCheck size={17} aria-hidden="true" />
            <span><strong>{t("install.groupChecks")}</strong><small>{t("install.groupChecksDesc")}</small></span>
          </header>
          <div className="installation-actions">
            <button className="is-primary" disabled={!csgoPath || !!working} onClick={runChecks}>
              <ClipboardCheck size={17} />{working === "checks" ? t("install.working") : t("install.runChecks")}
            </button>
            <button disabled={!csgoPath || !!working} onClick={() => run("verify", verifyInstallation)}>
              <RefreshCw size={17} />{working === "verify" ? t("install.working") : t("install.verify")}
            </button>
          </div>
        </section>

        <section className="inst-group">
          <header className="inst-group__head">
            <Wrench size={17} aria-hidden="true" />
            <span><strong>{t("install.groupRepair")}</strong><small>{t("install.groupRepairDesc")}</small></span>
          </header>
          <div className="installation-actions">
            {!installation?.installed && installation?.can_install && (
              <button className="is-primary" disabled={!csgoPath || blocked || !!working}
                onClick={() => preflightAndRun("install", installPayload)}>
                <FileCheck2 size={17} />{working === "install" ? t("install.working") : t(ACTION_KEYS[installation.migration_kind])}
              </button>
            )}
            {installation?.installed && (
              <button disabled={blocked || !!working} onClick={() => preflightAndRun("repair", repairPayload)}>
                <Wrench size={17} />{working === "repair" ? t("install.working") : t("install.repair")}
              </button>
            )}
            {!installation?.installed && !installation?.can_install && (
              <p className="inst-group__empty">{t("install.action.blocked")}</p>
            )}
          </div>
        </section>

        <section className="inst-group inst-group--danger">
          <header className="inst-group__head">
            <ArchiveRestore size={17} aria-hidden="true" />
            <span><strong>{t("install.groupRestore")}</strong><small>{t("install.groupRestoreDesc")}</small></span>
          </header>
          <div className="installation-actions">
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
          <p className="inst-diagnostics-scope">{t("install.diagnosticsContents")}</p>
        </section>
      </div>

      {checks && (
        <section className={`install-check-report report-${checks.overall}`}>
          <div className="install-check-summary">
            <span><ClipboardCheck size={18} /><strong>{t("install.checkReport")}</strong></span>
            <span className="install-check-counts"><b className="check-pass">{checks.pass_count} {t("install.pass")}</b><b className="check-warn">{checks.warn_count} {t("install.warn")}</b><b className="check-fail">{checks.fail_count} {t("install.fail")}</b>{checks.blocking_fail_count > 0 && <b className="check-blocking">{checks.blocking_fail_count} {t("install.action.blocked")}</b>}</span>
          </div>
          <div className="install-check-list">
            {checks.checks.map((check) => {
              const Icon = check.status === "pass" ? CheckCircle2 : check.status === "warn" ? CircleAlert : CircleX;
              const copy = localizeInstallCheck(check, t);
              return <details className={`install-check check-${check.status} ${check.blocking ? "is-blocking" : ""}`} key={check.code} open={check.status === "fail"}>
                <summary><Icon size={16} /><span><strong>{copy.title}</strong><small>{check.code}{check.blocking ? ` · ${t("install.action.blocked")}` : ""}</small></span></summary>
                <div><p><b>{t("install.evidence")}</b>{check.evidence}</p>{check.status !== "pass" && <><p><b>{t("install.cause")}</b>{copy.cause}</p><p><b>{t("install.solution")}</b>{copy.action}</p></>}</div>
              </details>;
            })}
          </div>
        </section>
      )}

      {diagnosticPath && (
        <div className="inst-exported">
          <span className="inst-exported__head">
            <CheckCircle2 size={16} aria-hidden="true" />
            <strong>{t("err.exportReady")}</strong>
          </span>
          <code className="inst-exported__path" title={diagnosticPath}>{diagnosticPath}</code>
          <span className="inst-exported__actions">
            <button onClick={() => open(diagnosticPath.replace(/[\\/][^\\/]+$/, ""))}>
              <FolderOpen size={14} /> {t("install.openDiagnosticFolder")}
            </button>
            <button onClick={copyDiagnosticPath}>
              <Copy size={14} /> {t("err.copyPath")}
            </button>
            <button onClick={() => setDiagnosticPath(null)}>{t("common.ok")}</button>
          </span>
        </div>
      )}

      {restored && (
        <button className="steam-verify" onClick={() => openExternalUrl("steam://validate/730")}>
          {t("install.openSteamVerify")}
        </button>
      )}
      <Modal open={!!confirmAction} title={confirmAction === "pristine" ? t("install.pristine") : t("install.restore")} onClose={() => setConfirmAction(null)} footer={<><button className="install-confirm-cancel" onClick={() => setConfirmAction(null)}>{t("common.cancel")}</button><button className="install-confirm-accept" onClick={() => void (confirmAction === "pristine" ? pristine() : restore())}>{confirmAction === "pristine" ? t("install.pristine") : t("install.restore")}</button></>}>
        <p className="install-confirm-copy">{confirmAction === "pristine" ? t("install.confirmPristine") : t("install.confirmRestore")}</p>
      </Modal>
    </div>
  );
}
