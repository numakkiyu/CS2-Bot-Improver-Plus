import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Settings, X } from "lucide-react";
import { useT } from "../i18n";
import { isPanelTauriRuntime } from "../lib/runtime";
import { useStore } from "../state/store";
import "./TitleBar.css";

type Props = {
  title?: string;
  onSettings: () => void;
  showSettings?: boolean;
};

export default function TitleBar({ title = "CS2BotImproverPlus v1.4.2.5", onSettings, showSettings = true }: Props) {
  const appWindow = isPanelTauriRuntime ? getCurrentWindow() : null;
  const t = useT();
  const { reportError } = useStore();

  const minimize = () => {
    if (appWindow) void appWindow.minimize().catch(reportError);
  };

  const close = () => {
    if (appWindow) void appWindow.close().catch(reportError);
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar__title" data-tauri-drag-region>
        {title}
      </span>
      <div className="titlebar__controls">
        {showSettings && <button
          className="tl tl--green"
          title={t("tb.settings")}
          aria-label={t("tb.settings")}
          onClick={onSettings}
        >
          <Settings size={14} />
        </button>}
        <button
          className="tl tl--yellow"
          title={t("tb.minimize")}
          aria-label={t("tb.minimize")}
          onClick={minimize}
        >
          <Minus size={14} />
        </button>
        <button
          className="tl tl--red"
          title={t("tb.close")}
          aria-label={t("tb.close")}
          onClick={close}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
