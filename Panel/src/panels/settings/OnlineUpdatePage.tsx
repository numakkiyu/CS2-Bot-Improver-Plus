import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, PackageCheck, RefreshCw, X } from "lucide-react";
import { api, toAppError, type OnlineUpdateSnapshot, type UpdateProgress } from "../../lib/api";
import { useStore } from "../../state/store";
import { useT } from "../../i18n";

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatTime(value: number | null) {
  return value ? new Date(value * 1000).toLocaleString() : "--";
}

export default function OnlineUpdatePage() {
  const { csgoPath, process } = useStore();
  const t = useT();
  const [snapshot, setSnapshot] = useState<OnlineUpdateSnapshot | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    try { setSnapshot(await api.getUpdateSnapshot()); } catch { /* startup checks stay silent */ }
  }, []);

  useEffect(() => {
    void refreshSnapshot();
    const unlisten = listen<UpdateProgress>("update-progress", () => void refreshSnapshot());
    return () => { void unlisten.then((dispose) => dispose()); };
  }, [refreshSnapshot]);

  const check = async () => {
    setWorking("check");
    setLocalError(null);
    try { setSnapshot(await api.checkOnlineUpdates(true)); }
    catch (error) { setLocalError(toAppError(error).detail); await refreshSnapshot(); }
    finally { setWorking(null); }
  };

  const install = async (component: "panel" | "plugin") => {
    if (component === "plugin" && !csgoPath) return;
    setWorking(component);
    setLocalError(null);
    try {
      if (component === "panel") await api.installPanelUpdate();
      else await api.installPluginUpdate(csgoPath!);
      await refreshSnapshot();
    } catch (error) {
      setLocalError(toAppError(error).detail);
      await refreshSnapshot();
    } finally { setWorking(null); }
  };

  const cancel = async () => {
    await api.cancelUpdate();
    setWorking(null);
  };

  const blocked = !!process?.running && (process.matches_selected || !process.path_accessible);
  const componentSection = (component: "panel" | "plugin") => {
    const state = snapshot?.[component];
    const progress = state?.total_bytes
      ? Math.min(100, Math.round((state.downloaded_bytes / state.total_bytes) * 100)) : 0;
    const installing = working === component || (snapshot?.busy && state?.status === "downloading");
    const canInstall = !!state?.update_available && state.compatible && !snapshot?.busy && !working
      && (component === "panel" || (!!csgoPath && !blocked));
    return (
      <section className="update-component" key={component}>
        <div className="update-component__head">
          <span className={`update-component__icon update-component__icon--${component}`}>
            {component === "panel" ? <Download size={20} /> : <PackageCheck size={20} />}
          </span>
          <div>
            <strong>{component === "panel" ? t("update.panel") : t("update.plugin")}</strong>
            <small>{component === "panel" ? t("update.panelDesc") : t("update.pluginDesc")}</small>
          </div>
          <span className={`update-status update-status--${state?.status ?? "idle"}`}>
            {state?.update_available ? t("update.available") : t("update.current")}
          </span>
        </div>
        <div className="update-facts">
          <span><small>{t("update.currentVersion")}</small><strong>{state?.current_version ?? "--"}</strong></span>
          <span><small>{t("update.latestVersion")}</small><strong>{state?.latest_version ?? "--"}</strong></span>
          <span><small>{t("update.size")}</small><strong>{formatBytes(state?.total_bytes ?? 0)}</strong></span>
        </div>
        {(installing || !!state?.downloaded_bytes) && (
          <div className="update-progress">
            <div><span style={{ width: `${progress}%` }} /></div>
            <small>{state?.status === "extracting" ? t("update.extracting") : t("update.downloading", { n: progress })}</small>
          </div>
        )}
        {component === "plugin" && blocked && <p className="update-note">{t("update.closeCs2")}</p>}
        {state && !state.compatible && <p className="update-note">{t("update.panelRequired")}</p>}
        <div className="update-actions">
          <button className="is-primary" disabled={!canInstall} onClick={() => install(component)}>
            <Download size={16} />{t(component === "panel" ? "update.installPanel" : "update.installPlugin")}
          </button>
          {installing && <button onClick={cancel}><X size={16} />{t("update.cancel")}</button>}
        </div>
      </section>
    );
  };

  return (
    <div className="online-update-page">
      <div className="update-toolbar">
        <span><small>{t("update.lastChecked")}</small><strong>{formatTime(snapshot?.checked_at ?? null)}</strong></span>
        <div>
          {snapshot?.release_notes_url && (
            <button title={t("update.releaseNotes")} onClick={() => openUrl(snapshot.release_notes_url!)}>
              <ExternalLink size={16} />{t("update.releaseNotes")}
            </button>
          )}
          <button disabled={working === "check" || snapshot?.busy} onClick={check}>
            <RefreshCw size={16} />{working === "check" ? t("update.checking") : t("update.check")}
          </button>
        </div>
      </div>
      {(localError || snapshot?.error) && <div className="update-error">{localError ?? snapshot?.error}</div>}
      {componentSection("panel")}
      {componentSection("plugin")}
    </div>
  );
}
