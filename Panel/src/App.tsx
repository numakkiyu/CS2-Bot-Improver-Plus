import { useCallback, useEffect, useState } from "react";
import {
  BookOpenText,
  Boxes,
  Command,
  Crosshair,
  History,
  LayoutDashboard,
  Settings2,
  SlidersHorizontal,
  Swords,
  type LucideIcon,
} from "lucide-react";
import TitleBar from "./components/TitleBar";
import ErrorModal from "./components/ErrorModal";
import OverviewDashboard, { type DashboardTarget } from "./panels/OverviewDashboard";
import PresetsPanel from "./panels/PresetsPanel";
import BotItemsPanel from "./panels/BotItemsPanel";
import CommandsPanel from "./panels/CommandsPanel";
import WeaponPresetsPanel from "./panels/WeaponPresetsPanel";
import MatchPanel from "./panels/MatchPanel";
import MatchHistoryPanel from "./panels/MatchHistoryPanel";
import GuideView from "./panels/GuideView";
import SettingsView from "./panels/settings/SettingsView";
import FirstRunLanguages from "./panels/settings/FirstRunLanguages";
import { useStore } from "./state/store";
import { useT, type I18nKey } from "./i18n";
import upstreamAppLogo from "./assets/upstream-app-logo.png";
import "./App.css";

type View = "main" | DashboardTarget;

const VIEWS: View[] = ["main", "match", "matchHistory", "settings", "presets", "botItems", "commands", "weaponPresets", "guide"];
const VIEW_KEY = "cs2bi.view";

export default function App() {
  const { error, clearError, ready, config, exportDiagnostics } = useStore();
  const t = useT();
  // Remember the open view in the portable Panel memory.
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem(VIEW_KEY) as View | null;
    return saved && VIEWS.includes(saved) ? saved : "main";
  });
  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
  }, [view]);
  // Anchor inside the guide requested by the error modal deep link.
  const [guideAnchor, setGuideAnchor] = useState<string | null>(null);
  const clearGuideAnchor = useCallback(() => setGuideAnchor(null), []);
  const openGuide = useCallback((anchor: string) => {
    setGuideAnchor(anchor);
    setView("guide");
  }, []);
  const firstRun = ready && !!config && !config.first_run_done;

  const NAV: { view: View; key: I18nKey; icon: LucideIcon }[] = [
    { view: "main", key: "nav.overview", icon: LayoutDashboard },
    { view: "match", key: "match.title", icon: Swords },
    { view: "matchHistory", key: "match.history", icon: History },
    { view: "presets", key: "pre.title", icon: SlidersHorizontal },
    { view: "botItems", key: "bi.title", icon: Boxes },
    { view: "commands", key: "cmd.title", icon: Command },
    { view: "weaponPresets", key: "weapons.title", icon: Crosshair },
    { view: "guide", key: "nav.guide", icon: BookOpenText },
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
            <small>v1.4.2.5-Preview.4</small>
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
          ) : view === "match" ? (
            <MatchPanel onOpenInstallation={() => setView("settings")} onOpenHistory={() => setView("matchHistory")} />
          ) : view === "matchHistory" ? (
            <MatchHistoryPanel />
          ) : view === "guide" ? (
            <GuideView anchor={guideAnchor} onAnchorHandled={clearGuideAnchor} />
          ) : (
            <OverviewDashboard onNavigate={setView} />
          )}
        </main>
      </div>

      <ErrorModal error={error} onClose={clearError} onExport={exportDiagnostics} onOpenGuide={openGuide} />
      {firstRun && <FirstRunLanguages />}
    </div>
  );
}
