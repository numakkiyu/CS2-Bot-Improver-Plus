import { getCurrentWindow } from "@tauri-apps/api/window";
import { GearIcon, MinusIcon, CloseIcon } from "./icons";
import { useT } from "../i18n";
import "./TitleBar.css";

type Props = {
  title?: string;
  onSettings: () => void;
};

export default function TitleBar({ title = "CS2 Bot Improver v1.4.2", onSettings }: Props) {
  const appWindow = getCurrentWindow();
  const t = useT();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar__title" data-tauri-drag-region>
        {title}
      </span>
      <div className="titlebar__controls">
        <button
          className="tl tl--green"
          title={t("tb.settings")}
          aria-label={t("tb.settings")}
          onClick={onSettings}
        >
          <GearIcon size={12} />
        </button>
        <button
          className="tl tl--yellow"
          title={t("tb.minimize")}
          aria-label={t("tb.minimize")}
          onClick={() => appWindow.minimize()}
        >
          <MinusIcon size={12} />
        </button>
        <button
          className="tl tl--red"
          title={t("tb.close")}
          aria-label={t("tb.close")}
          onClick={() => appWindow.close()}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    </header>
  );
}
