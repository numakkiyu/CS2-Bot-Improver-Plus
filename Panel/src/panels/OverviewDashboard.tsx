import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  Boxes,
  Command,
  Crosshair,
  Download,
  History,
  Play,
  Settings2,
  SlidersHorizontal,
  Swords,
  type LucideIcon,
} from "lucide-react";
import StatusBar from "../components/StatusBar";
import ModeCard from "./ModeCard";
import DifficultyCard from "./DifficultyCard";
import { api, type MatchSession, type OnlineUpdateSnapshot } from "../lib/api";
import { useStore } from "../state/store";
import { MAP_IMAGES, MAP_LABELS } from "../data/maps";
import { useT, type I18nKey } from "../i18n";

export type DashboardTarget =
  | "match" | "matchHistory" | "settings" | "presets" | "botItems" | "commands" | "weaponPresets" | "guide";

type Tile = { view: DashboardTarget; key: I18nKey; icon: LucideIcon };

const TILES: Tile[] = [
  { view: "match", key: "match.title", icon: Swords },
  { view: "matchHistory", key: "match.history", icon: History },
  { view: "weaponPresets", key: "weapons.title", icon: Crosshair },
  { view: "presets", key: "pre.title", icon: SlidersHorizontal },
  { view: "botItems", key: "bi.title", icon: Boxes },
  { view: "commands", key: "cmd.title", icon: Command },
  { view: "guide", key: "nav.guide", icon: BookOpenText },
  { view: "settings", key: "set.title", icon: Settings2 },
];

export default function OverviewDashboard({ onNavigate }: { onNavigate: (view: DashboardTarget) => void }) {
  const t = useT();
  const { directory } = useStore();
  const csgo = directory?.valid ? directory.selected : null;
  const [updates, setUpdates] = useState<OnlineUpdateSnapshot | null>(null);
  const [history, setHistory] = useState<MatchSession[] | null>(null);

  useEffect(() => {
    void api.getUpdateSnapshot().then(setUpdates).catch(() => {});
  }, []);

  useEffect(() => {
    if (!csgo) {
      setHistory(null);
      return;
    }
    void api.listMatchHistory(csgo).then(setHistory).catch(() => {});
  }, [csgo]);

  const updateAvailable = !!updates && (updates.panel.update_available || updates.plugin.update_available);
  const latest = history?.[0] ?? null;

  return (
    <div className="dashboard">
      <header className="workspace__head">
        <span className="workspace__eyebrow">PLUS</span>
        <h1>{t("nav.overview")}</h1>
      </header>
      <StatusBar onOpenSettings={() => onNavigate("settings")} />

      {updateAvailable && (
        <button className="update-banner" onClick={() => onNavigate("settings")}>
          <span className="update-banner__icon" aria-hidden="true"><Download size={17} /></span>
          <strong>{t("update.available")}</strong>
          <small>{updates.release_version ? `v${updates.release_version}` : ""}</small>
          <span className="update-banner__action">
            {t("set.updates")}
            <ArrowRight size={14} />
          </span>
        </button>
      )}

      <div className="dashboard__controls">
        <ModeCard />
        <DifficultyCard />
      </div>

      {latest ? (
        <button className="recent-match glass" onClick={() => onNavigate("matchHistory")}>
          <span className="recent-match__map" aria-hidden="true">
            {MAP_IMAGES[latest.map_id] && <img src={MAP_IMAGES[latest.map_id]} alt="" />}
            <i>{MAP_LABELS[latest.map_id] ?? latest.map_id}</i>
          </span>
          <span className="recent-match__body">
            <small>{t("match.recentMatches")}</small>
            <strong>
              {latest.player_score} : {latest.opponent_score}
              <em>· {latest.opponent_name}</em>
            </strong>
            <span>{new Date(latest.created_at_unix * 1000).toLocaleString()}</span>
          </span>
          <span className={`recent-match__state is-${latest.state}`}>
            {t(latest.state === "finished" ? "match.finished" : "match.interrupted")}
          </span>
        </button>
      ) : (
        <button className="recent-match recent-match--empty" onClick={() => onNavigate("match")}>
          <span className="recent-match__empty-icon" aria-hidden="true"><Play size={17} /></span>
          <span className="recent-match__body">
            <small>{t("match.recentMatches")}</small>
            <strong>{t("overview.startFirstMatch")}</strong>
            <span>{t("match.emptyHistory")}</span>
          </span>
          <ArrowRight size={16} className="recent-match__chev" />
        </button>
      )}

      <div className="quick-grid" role="navigation" aria-label={t("overview.quickActions")}>
        {TILES.map(({ view, key, icon: Icon }) => (
          <button key={view} className="quick-tile" onClick={() => onNavigate(view)}>
            <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
            <span>{t(key)}</span>
          </button>
        ))}
      </div>

      <button className="tutorial-card glass" onClick={() => onNavigate("guide")}>
        <span className="tutorial-card__icon" aria-hidden="true">
          <BookOpenText size={22} strokeWidth={1.8} />
        </span>
        <span className="tutorial-card__body">
          <small>{t("overview.guideEyebrow")}</small>
          <strong>{t("overview.guideTitle")}</strong>
          <span>{t("overview.guideDesc")}</span>
        </span>
        <span className="tutorial-card__action">
          {t("overview.guideAction")}
          <ArrowRight size={16} strokeWidth={1.9} />
        </span>
      </button>
    </div>
  );
}
