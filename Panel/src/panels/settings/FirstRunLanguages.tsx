import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FolderSearch, ShieldCheck } from "lucide-react";
import { useStore } from "../../state/store";
import { LANGUAGES } from "../../data/languages";
import { useT, type I18nKey } from "../../i18n";
import type { InstallationSource, InstallPlan, MigrationKind } from "../../lib/api";
import StatusDot from "../../components/StatusDot";
import "./settings.css";

type Step = "language" | "directory" | "preview" | "complete";

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

export default function FirstRunLanguages() {
  const {
    config, directory, process, updateConfig, chooseDirectory, getInstallPlan,
    installPayload, reportError,
  } = useStore();
  const t = useT();
  const saved = config?.first_run_step;
  const initial = saved === "directory" || saved === "preview" || saved === "complete" ? saved : "language";
  const [step, setStep] = useState<Step>(initial);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [working, setWorking] = useState(false);
  const selected = directory?.selected ?? null;
  const blocked = !!process?.running && (process.matches_selected || !process.path_accessible);

  useEffect(() => {
    if (step !== "preview" || plan) return;
    let active = true;
    setWorking(true);
    void getInstallPlan()
      .then((result) => { if (active && result) setPlan(result); })
      .finally(() => { if (active) setWorking(false); });
    return () => { active = false; };
  }, [getInstallPlan, plan, step]);

  const move = async (next: Step) => {
    setStep(next);
    await updateConfig({ first_run_step: next });
  };

  const browse = async () => {
    if (working) return;
    try {
      const picked = await open({ directory: true, title: "Select game/csgo folder" });
      if (typeof picked === "string") await chooseDirectory(picked);
    } catch (error) { reportError(error); }
  };

  const preview = async () => {
    if (working) return;
    setWorking(true);
    try {
      const result = await getInstallPlan();
      if (!result) return;
      setPlan(result);
      await move("preview");
    } finally { setWorking(false); }
  };

  const install = async () => {
    if (working) return;
    setWorking(true);
    try {
      const result = await installPayload();
      if (result) await move("complete");
    } finally { setWorking(false); }
  };

  const finish = () => updateConfig({ first_run_done: true, first_run_step: "complete" });

  return (
    <div className="firstrun">
      <div className="firstrun__card glass glass-strong">
        {step === "language" && <>
          <h2 className="firstrun__title">{t("first.language")}</h2>
          <div className="lang-grid">
            {LANGUAGES.map((language) => (
              <button key={language.code} className="lang-cell"
                onClick={async () => {
                  await updateConfig({ language: language.code, first_run_step: "directory" });
                  setStep("directory");
                }}>
                {language.native}
              </button>
            ))}
          </div>
        </>}

        {step === "directory" && <>
          <div className="firstrun__heading"><FolderSearch size={22} /><span>
            <h2>{t("first.directory")}</h2><p>{t("first.directoryDesc")}</p>
          </span></div>
          <div className="firstrun__directories">
            {(directory?.candidates ?? []).map((path) => (
              <button key={path} className={`dir-cell ${path === selected ? "is-selected" : ""}`}
                disabled={working}
                onClick={() => chooseDirectory(path)}>
                <span className="dir-cell__path">{path}</span>
                {path === selected && <StatusDot status="green" />}
              </button>
            ))}
            {!directory?.candidates.length && <div className="dir-note">{t("set.noCsgo")}</div>}
          </div>
          <div className="firstrun__footer">
            <button disabled={working} onClick={browse}>{t("set.browse")}</button>
            <button className="is-primary" disabled={!selected || blocked || working} onClick={preview}>
              {working ? t("install.working") : t("first.continue")}
            </button>
          </div>
        </>}

        {step === "preview" && <>
          <div className="firstrun__heading"><ShieldCheck size={22} /><span>
            <h2>{t("first.preview")}</h2><p>{t("first.previewDesc")}</p>
          </span></div>
          {plan && <div className="install-preview">
            <div className={`install-source install-source--${plan.source}`}>
              <span><small>{t("install.source")}</small><strong>{t(SOURCE_KEYS[plan.source])}</strong></span>
              <p>{t(SOURCE_DESC_KEYS[plan.source])}</p>
            </div>
            <span><small>{t("install.target")}</small><strong>{plan.target}</strong></span>
            <div><b>{t("install.files", { n: plan.total_files })}</b><b>{t("install.newFiles", { n: plan.new_files })}</b><b>{t("install.overwritten", { n: plan.overwritten_files })}</b></div>
            <span><small>{t("install.backup")}</small><strong>{plan.backup_path}</strong></span>
          </div>}
          <div className="firstrun__footer">
            <button onClick={() => move("directory")}>{t("first.back")}</button>
            {plan?.can_install ? (
              <button className="is-primary" disabled={working || blocked} onClick={install}>
                {working ? t("install.working") : t(ACTION_KEYS[plan.migration_kind])}
              </button>
            ) : (
              <button className="is-primary" disabled={working} onClick={finish}>
                {t("first.openWithoutInstall")}
              </button>
            )}
          </div>
        </>}

        {step === "complete" && <div className="firstrun__complete">
          <CheckCircle2 size={38} />
          <h2>{t("first.complete")}</h2>
          <p>{t("first.completeDesc")}</p>
          <button className="is-primary" onClick={finish}>{t("first.finish")}</button>
        </div>}
      </div>
    </div>
  );
}
