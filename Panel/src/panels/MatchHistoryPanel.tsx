import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Film, Trash2 } from "lucide-react";
import Modal from "../components/Modal";
import { api, type MatchResult, type MatchSession } from "../lib/api";
import { useT, type I18nKey } from "../i18n";
import { useStore } from "../state/store";
import MatchResultView from "./MatchResultView";
import { MAP_IMAGES, MAP_LABELS } from "../data/maps";
import "./MatchPanel.css";

type Outcome = "won" | "lost" | "draw" | "interrupted" | "active";

const OUTCOME_KEYS: Record<Outcome, I18nKey | null> = {
  won: "match.won",
  lost: "match.lost",
  draw: "match.draw",
  interrupted: "match.interrupted",
  active: null,
};

function outcomeOf(session: MatchSession): Outcome {
  if (session.state === "interrupted") return "interrupted";
  if (session.state !== "finished") return "active";
  if (session.player_score > session.opponent_score) return "won";
  if (session.player_score < session.opponent_score) return "lost";
  return "draw";
}

function formatTime(unix: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(unix * 1000));
}

export default function MatchHistoryPanel() {
  const t = useT();
  const { directory, reportError } = useStore();
  const csgo = directory?.valid ? directory.selected : null;
  const [history, setHistory] = useState<MatchSession[]>([]);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<MatchSession | null>(null);

  const refresh = useCallback(async () => {
    if (!csgo) return setHistory([]);
    try { setHistory((await api.listMatchHistory(csgo)) ?? []); } catch (error) { reportError(error); }
  }, [csgo, reportError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const stats = useMemo(() => {
    const finished = history.filter((session) => session.state === "finished");
    if (finished.length === 0) return null;
    const wins = finished.filter((session) => session.player_score > session.opponent_score).length;
    const avgScore = finished.reduce((sum, session) => sum + session.player_score, 0) / finished.length;
    const mapCounts = new Map<string, number>();
    for (const session of finished) mapCounts.set(session.map_id, (mapCounts.get(session.map_id) ?? 0) + 1);
    const favMap = [...mapCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      total: history.length,
      winRate: wins / finished.length,
      avgScore,
      favMap,
      form: finished.slice(0, 5).map(outcomeOf),
    };
  }, [history]);

  const openResult = async (session: MatchSession) => {
    if (!csgo || !session.result_path || !["finished", "interrupted"].includes(session.state)) return;
    try { setResult(await api.getMatchResult(csgo, session.session_id)); } catch (error) { reportError(error); }
  };

  const confirmDelete = async () => {
    if (!csgo || !deleteCandidate) return;
    try {
      await api.deleteMatch(csgo, deleteCandidate.session_id, true);
      setDeleteCandidate(null);
      await refresh();
    } catch (error) { reportError(error); }
  };

  if (result) return <MatchResultView result={result} onClose={() => setResult(null)} t={t} csgo={csgo} />;

  return <div className="match-page match-history-page">
    <header className="workspace__head match-page__head">
      <div className="match-page__title">
        <span className="workspace__eyebrow">PLUS MATCH</span>
        <h1>{t("match.history")}</h1>
        <p>{t("match.historySubtitle")}</p>
      </div>
      <span className="match-map-count">{history.length}</span>
    </header>

    {stats && (
      <section className="mh-stats glass">
        <div className="mh-stat"><small>{t("mh.totalMatches")}</small><strong>{stats.total}</strong></div>
        <div className="mh-stat">
          <small>{t("mh.winRate")}</small>
          <strong className={stats.winRate >= 0.5 ? "is-good" : "is-bad"}>{Math.round(stats.winRate * 100)}%</strong>
        </div>
        <div className="mh-stat"><small>{t("mh.avgScore")}</small><strong>{stats.avgScore.toFixed(1)}</strong></div>
        <div className="mh-stat"><small>{t("mh.favMap")}</small><strong>{stats.favMap ? MAP_LABELS[stats.favMap] ?? stats.favMap : "--"}</strong></div>
        <div className="mh-stat">
          <small>{t("mh.form")}</small>
          <span className="mh-form">
            {stats.form.map((outcome, index) => (
              <i key={index} className={`is-${outcome}`}>{outcome === "won" ? "W" : outcome === "lost" ? "L" : "D"}</i>
            ))}
          </span>
        </div>
      </section>
    )}

    {history.length === 0 ? (
      <div className="match-empty"><Clock3 size={19} /><span>{t("match.emptyHistory")}</span></div>
    ) : (
      <div className="mh-cards">
        {history.map((session, index) => {
          const outcome = outcomeOf(session);
          return (
            <article
              className={`mh-card is-${outcome}`}
              key={session.session_id}
              style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
              onClick={() => void openResult(session)}
            >
              <span className="mh-card__map" aria-hidden="true">
                {MAP_IMAGES[session.map_id] && <img src={MAP_IMAGES[session.map_id]} alt="" />}
                <i>{MAP_LABELS[session.map_id] ?? session.map_id}</i>
              </span>
              <span className="mh-card__main">
                <span className="mh-card__scoreline">
                  {OUTCOME_KEYS[outcome] && <em className={`mh-badge is-${outcome}`}>{t(OUTCOME_KEYS[outcome]!)}</em>}
                  <strong>{session.player_score} : {session.opponent_score}</strong>
                </span>
                <span className="mh-card__meta">
                  <b>{session.opponent_name}</b>
                  <span>{formatTime(session.created_at_unix)}</span>
                  <span className={`mh-card__demo is-${session.demo.state}`}><Film size={12} />{t(`match.demoState.${session.demo.state}`)}</span>
                </span>
              </span>
              <span className="mh-card__actions">
                <button
                  className="match-history-delete"
                  onClick={(event) => { event.stopPropagation(); setDeleteCandidate(session); }}
                  aria-label={t("match.delete")}
                  title={t("match.delete")}
                >
                  <Trash2 size={15} />
                </button>
              </span>
            </article>
          );
        })}
      </div>
    )}

    <Modal open={!!deleteCandidate} title={t("match.delete")} onClose={() => setDeleteCandidate(null)} footer={<><button className="match-dialog-cancel" onClick={() => setDeleteCandidate(null)}>{t("common.cancel")}</button><button className="match-dialog-delete" onClick={() => void confirmDelete()}>{t("match.delete")}</button></>}><p className="match-dialog-copy">{t("match.confirmDelete")}</p></Modal>
  </div>;
}
