import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  Boxes,
  Command,
  Crosshair,
  ExternalLink,
  LayoutDashboard,
  Settings2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import TitleBar from "./components/TitleBar";
import StatusBar from "./components/StatusBar";
import ErrorModal from "./components/ErrorModal";
import ModeCard from "./panels/ModeCard";
import DifficultyCard from "./panels/DifficultyCard";
import PresetsPanel from "./panels/PresetsPanel";
import BotItemsPanel from "./panels/BotItemsPanel";
import CommandsPanel from "./panels/CommandsPanel";
import WeaponPresetsPanel from "./panels/WeaponPresetsPanel";
import SettingsView from "./panels/settings/SettingsView";
import FirstRunLanguages from "./panels/settings/FirstRunLanguages";
import { useStore } from "./state/store";
import { useT, type I18nKey } from "./i18n";
import upstreamAppLogo from "./assets/upstream-app-logo.png";
import "./App.css";

type View = "main" | "settings" | "presets" | "botItems" | "commands" | "weaponPresets";

const VIEWS: View[] = ["main", "settings", "presets", "botItems", "commands", "weaponPresets"];
const VIEW_KEY = "cs2bi.view";
const TUTORIAL_URL = "https://www.xiaoheihe.cn/app/bbs/link/ae2271904052?h_camp=link&redirect_data=%7B%22link%22%3A%7B%22description%22%3A%22%5Cu5c0f%5Cu65f6%5Cu5019%5Cuff0c%5Cu6211%5Cu6700%5Cu559c%5Cu6b22%5Cu73a9%5Cu300a%5Cu53cd%5Cu6050%5Cu7cbe%5Cu82f1%5Cuff1a%5Cu96f6%5Cu70b9%5Cu884c%5Cu52a8%5Cu300b%5Cu4e2d%5Cu7684%5Cu4efb%5Cu52a1%5Cu6a21%5Cu5f0f%5Cu3002%5Cu611f%5Cu53d7%5Cu7ec4%5Cu5efa%5Cu56e2%5Cu961f%5Cuff0c%5Cu4e0e%5Cu4eba%5Cu673a%5Cu535a%5Cu5f08%5Cu7684%5Cu5feb%5Cu4e50%5Cu3002CS2%5Cu66f4%5Cu65b0%5Cu4e4b%5Cu540e%5Cuff0c%5Cu4eba%5Cu673a%5Cu53d8%5Cu5f97%5Cu611a%5Cu8822%5Cu81f3%5Cu6781%5Cuff0c%5Cu4ed6%5Cu4eec%5Cu53ea%5Cu4f1a%5Cu7784%5Cu51c6%5Cu809a%5Cu5b50%5Cu4e2d%5Cu592e%5Cuff0c%5Cu53ef%5Cu80fd%5Cu4f1a%5Cu5361%5Cu5728%5Cu5730%5Cu56fe%5Cu7684%5Cu4efb%5Cu4f55%5Cu4e00%5Cu4e2a%5Cu5730%5Cu65b9%5Cuff0c%5Cu6218%5Cu672f%5Cu4e0a%5Cu66f4%5Cu662f%5Cu6beb%5Cu65e0%5Cu7b56%5Cu7565%5Cu53ef%5Cu8a00%5Cu3002%5Cu4e8e%5Cu662f%5Cuff0c%5Cu6211%5Cu5f00%5Cu59cb%5Cu5f00%5Cu53d1%5Cu8fd9%5Cu4e2a%5Cu63d2%5Cu4ef6%5Cuff0c%5Cu4ee5%5Cu6539%5Cu8fdbCS2%5Cu4e2d%5Cu7684%5Cu4eba%5Cu673a%5Cuff0c%5Cu63d0%5Cu4f9b%5Cu7ed9%5Cu50cf%5Cu6211%5Cu8fd9%22%2C%22title%22%3A%22cs2%5Cu4eba%5Cu673abot%5Cu52a0%5Cu5f3a%5Cuff01%5Cu5b89%5Cu88c5%5Cu4e0e%5Cu4f7f%5Cu7528%5Cu6559%5Cu7a0b%5Cuff08%5Cu6301%5Cu7eed%5Cu66f4%5Cu65b0%5Cuff09%22%7D%7D&h_src=YXBwX3NoYXJl";

export default function App() {
  const { error, clearError, ready, config, reportError } = useStore();
  const t = useT();
  // Remember the open view within a session (survives a webview reload), while a
  // fresh launch still starts on the main screen — sessionStorage clears on close.
  const [view, setView] = useState<View>(() => {
    const saved = sessionStorage.getItem(VIEW_KEY) as View | null;
    return saved && VIEWS.includes(saved) ? saved : "main";
  });
  useEffect(() => {
    sessionStorage.setItem(VIEW_KEY, view);
  }, [view]);
  const firstRun = ready && !!config && !config.first_run_done;

  const openTutorial = async () => {
    try {
      await openUrl(TUTORIAL_URL);
    } catch (error) {
      reportError(error);
    }
  };

  const NAV: { view: View; key: I18nKey; icon: LucideIcon }[] = [
    { view: "main", key: "nav.overview", icon: LayoutDashboard },
    { view: "presets", key: "pre.title", icon: SlidersHorizontal },
    { view: "botItems", key: "bi.title", icon: Boxes },
    { view: "commands", key: "cmd.title", icon: Command },
    { view: "weaponPresets", key: "weapons.title", icon: Crosshair },
    { view: "settings", key: "set.title", icon: Settings2 },
  ];

  return (
    <div className="shell">
      <TitleBar
        showSettings
        onSettings={() => setView((v) => (v === "settings" ? "main" : "settings"))}
      />

      <div className="shell__frame">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <img className="sidebar__mark" src={upstreamAppLogo} alt="" aria-hidden="true" />
            <span className="sidebar__brand-copy">
              <strong>CS2BotImprover</strong>
              <small>PLUS</small>
            </span>
          </div>

          <span className="sidebar__label">{t("nav.workspace")}</span>
          <nav className="sidebar__nav" aria-label={t("nav.workspace")}>
            {NAV.map(({ view: target, key, icon: Icon }) => (
              <button
                key={target}
                className={`sidebar__item ${view === target ? "is-active" : ""}`}
                onClick={() => setView(target)}
                aria-current={view === target ? "page" : undefined}
              >
                <Icon size={18} strokeWidth={1.9} />
                <span>{t(key)}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar__footer">
            <span>PLUS</span>
            <small>v1.4.2.1</small>
          </div>
        </aside>

        <main className="workspace">
          {view === "settings" ? (
            <SettingsView />
          ) : view === "presets" ? (
            <PresetsPanel />
          ) : view === "botItems" ? (
            <BotItemsPanel />
          ) : view === "commands" ? (
            <CommandsPanel />
          ) : view === "weaponPresets" ? (
            <WeaponPresetsPanel />
          ) : (
            <div className="dashboard">
              <header className="workspace__head">
                <span className="workspace__eyebrow">PLUS</span>
                <h1>{t("nav.overview")}</h1>
              </header>
              <StatusBar />
              <div className="dashboard__controls">
                <ModeCard />
                <DifficultyCard />
              </div>
              <button className="tutorial-card glass" onClick={openTutorial}>
                <span className="tutorial-card__icon" aria-hidden="true">
                  <BookOpen size={22} strokeWidth={1.8} />
                </span>
                <span className="tutorial-card__body">
                  <small>{t("overview.tutorialEyebrow")}</small>
                  <strong>{t("overview.tutorialTitle")}</strong>
                  <span>{t("overview.tutorialDesc")}</span>
                </span>
                <span className="tutorial-card__action">
                  {t("overview.tutorialAction")}
                  <ExternalLink size={16} strokeWidth={1.9} />
                </span>
              </button>
            </div>
          )}
        </main>
      </div>

      <ErrorModal error={error} onClose={clearError} />
      {firstRun && <FirstRunLanguages />}
    </div>
  );
}
