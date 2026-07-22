import { useMemo, useState } from "react";
import { Crosshair, Film, FolderOpen, Play, RotateCcw, Target, Trophy, UserRound, X, Zap } from "lucide-react";
import { api, type MatchResult, type PlayerMatchStats } from "../lib/api";
import { useStore } from "../state/store";
import type { useT } from "../i18n";
import { MAP_IMAGES, MAP_LABELS } from "../data/maps";
import { assignPlayerAvatarPaths, playerAvatarPath } from "../data/matchVisuals";
import "./MatchPanel.css";

type Outcome = "won" | "lost" | "draw" | "interrupted";

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatTime(unix: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(unix * 1000));
}

function maxBy(players: PlayerMatchStats[], pick: (p: PlayerMatchStats) => number) {
  return players.length ? players.reduce((best, p) => (pick(p) > pick(best) ? p : best)) : null;
}

function openRatingValue(rating: PlayerMatchStats["rating"]): number {
  return rating?.open_rating ?? rating?.rating_plus ?? 0;
}

function openRatingModelVersion(version: string): string {
  return version.replace("rating-plus", "open-rating");
}

function PlayerAvatar({ name, team, src, size = 28 }: { name: string; team: "ct" | "t"; src?: string; size?: number }) {
  return (
    <span className={`mr-avatar mr-avatar--${team}`} style={{ width: size, height: size }} aria-hidden="true">
      <UserRound className="mr-avatar__fallback" size={Math.round(size * 0.5)} />
      <img src={src ?? playerAvatarPath(name, team)} alt="" decoding="async" onError={(event) => { event.currentTarget.hidden = true; }} />
    </span>
  );
}

export default function MatchResultView({ result, onClose, t, csgo }: { result: MatchResult; onClose: () => void; t: ReturnType<typeof useT>; csgo?: string | null }) {
  const { reportError } = useStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const groups = ["ct", "t"] as const;
  const avatarPaths = useMemo(() => assignPlayerAvatarPaths(result.players), [result.players]);

  const outcome: Outcome = result.state === "interrupted"
    ? "interrupted"
    : result.player_score > result.opponent_score
      ? "won"
      : result.player_score < result.opponent_score
        ? "lost"
        : "draw";

  const mvp = maxBy(result.players, (p) => openRatingValue(p.rating));
  const topAdr = maxBy(result.players, (p) => p.adr);
  const topHs = maxBy(result.players, (p) => p.headshot_percent);
  const topKills = maxBy(result.players, (p) => p.kills);

  const playDemo = async () => {
    if (!csgo || !result.demo.path || demoBusy) return;
    setDemoBusy(true);
    try {
      await api.playDemo(csgo, result.demo.path);
    } catch (error) {
      reportError(error);
    } finally {
      setDemoBusy(false);
    }
  };

  const openDemoFolder = async () => {
    if (!csgo || !result.demo.path) return;
    try {
      await api.openDemoFolder(csgo, result.demo.path);
    } catch (error) {
      reportError(error);
    }
  };

  return <div className="match-page match-results">
    <header className="workspace__head match-page__head">
      <div className="match-page__title">
        <span className="workspace__eyebrow">{t("match.resultsEyebrow")}</span>
        <h1>{t("match.results")}</h1>
      </div>
      <button className="match-history-button" onClick={onClose}><X size={16} />{t("match.backToLobby")}</button>
    </header>

    <section className={`mr-hero is-${outcome}`}>
      {MAP_IMAGES[result.map_id] && <img className="mr-hero__bg" src={MAP_IMAGES[result.map_id]} alt="" aria-hidden="true" />}
      <div className="mr-hero__overlay">
        <span className={`mr-badge is-${outcome}`}>{t(`match.${outcome}`)}</span>
        <div className="mr-hero__score">
          <div><small>{t("match.yourTeam")}</small><strong>{result.player_score}</strong></div>
          <span>:</span>
          <div><small>{result.opponent_name}</small><strong>{result.opponent_score}</strong></div>
        </div>
        <small className="mr-hero__meta">
          {MAP_LABELS[result.map_id] ?? result.map_id} · {formatTime(result.finished_at_unix || result.started_at_unix)} · {openRatingModelVersion(result.rating_model_version)}
        </small>
      </div>
    </section>

    <div className="mr-chips">
      {mvp && (
        <span className="mr-chip" style={{ animationDelay: "0ms" }}>
          <Trophy size={15} aria-hidden="true" />
          <small>MVP</small>
          <strong>{mvp.name}</strong>
          <em>{openRatingValue(mvp.rating).toFixed(2)}</em>
        </span>
      )}
      {topAdr && (
        <span className="mr-chip" style={{ animationDelay: "50ms" }}>
          <Zap size={15} aria-hidden="true" />
          <small>{t("match.topAdr")}</small>
          <strong>{topAdr.name}</strong>
          <em>{topAdr.adr.toFixed(1)}</em>
        </span>
      )}
      {topHs && (
        <span className="mr-chip" style={{ animationDelay: "100ms" }}>
          <Crosshair size={15} aria-hidden="true" />
          <small>{t("match.topHs")}</small>
          <strong>{topHs.name}</strong>
          <em>{topHs.headshot_percent.toFixed(0)}%</em>
        </span>
      )}
      {topKills && (
        <span className="mr-chip" style={{ animationDelay: "150ms" }}>
          <Target size={15} aria-hidden="true" />
          <small>{t("match.topKills")}</small>
          <strong>{topKills.name}</strong>
          <em>{topKills.kills}</em>
        </span>
      )}
    </div>

    <div className="match-result-table glass">
      <div className="match-result-header">
        <span>{t("match.player")}</span><span>K-D-A</span><span>ADR</span><span>KAST</span><span>HS%</span><span>{t("match.swing")}</span><span>{t("match.openRating")}</span>
      </div>
      {groups.map((group) => (
        <div key={group}>
          <div className="match-team-divider">
            <span>{group === "ct" ? "CT" : "T"}</span>
            <small>{result.players.filter((player) => player.team === group).length} {t("match.players")}</small>
          </div>
          {result.players
            .filter((player) => player.team === group)
            .sort((a, b) => openRatingValue(b.rating) - openRatingValue(a.rating))
            .map((player) => {
              const rating = player.rating ? openRatingValue(player.rating) : null;
              const breakdown = player.rating ? [
                { label: t("match.ratingKills"), value: player.rating.kills },
                { label: t("match.ratingDamage"), value: player.rating.damage },
                { label: t("match.ratingSurvival"), value: player.rating.survival },
                { label: t("match.ratingKast"), value: player.rating.kast },
                { label: t("match.ratingMulti"), value: player.rating.multi_kills },
                { label: t("match.ratingSwing"), value: player.rating.round_swing },
                { label: t("match.ratingEconomy"), value: player.rating.economy_adjustment },
              ] : [];
              const peak = Math.max(0.0001, ...breakdown.map((row) => Math.abs(row.value)));
              return (
                <div className="match-result-row" key={player.player_id} onClick={() => setExpanded(expanded === player.player_id ? null : player.player_id)}>
                  <span className="match-player-name">
                    <PlayerAvatar name={player.name} team={player.team} src={avatarPaths.get(player.player_id)} />
                    <strong>{player.name}</strong>
                    <span className={`match-kind kind-${player.kind}`}>{player.kind === "human" ? "P" : "B"}</span>
                  </span>
                  <span className={player.difference >= 0 ? "positive" : "negative"}>{player.kills}-{player.deaths}-{player.assists}</span>
                  <span>{player.adr.toFixed(1)}</span>
                  <span>{player.kast_percent.toFixed(0)}%</span>
                  <span>{player.headshot_percent.toFixed(0)}%</span>
                  <span className={player.round_swing >= 0 ? "positive" : "negative"}>{player.round_swing.toFixed(2)}</span>
                  <strong className={`open-rating ${rating != null && rating >= 1.1 ? "is-high" : rating != null && rating < 0.9 ? "is-low" : "is-mid"}`}>
                    {rating?.toFixed(2) ?? "--"}
                  </strong>
                  {expanded === player.player_id && (
                    <div className="mr-detail" onClick={(event) => event.stopPropagation()}>
                      <div className="mr-detail__id">
                        <PlayerAvatar name={player.name} team={player.team} src={avatarPaths.get(player.player_id)} size={46} />
                        <span className="mr-detail__who">
                          <strong>{player.name}</strong>
                          <small>{player.kind === "human" ? t("match.kindHuman") : t("match.kindBot")} · {player.team.toUpperCase()} · {player.rounds_played} {t("match.rounds")}</small>
                        </span>
                        <span className="mr-detail__kda">
                          <span><small>K</small><b>{player.kills}</b></span>
                          <i>/</i>
                          <span><small>D</small><b>{player.deaths}</b></span>
                          <i>/</i>
                          <span><small>A</small><b>{player.assists}</b></span>
                        </span>
                        <span className="mr-detail__extras">
                          <span>{t("match.mvps")} <b>{player.mvps}</b></span>
                          <span>{t("match.clutches")} <b>{player.clutches}</b></span>
                          <span>{t("match.firstKills")} <b>{player.first_kills}</b></span>
                        </span>
                      </div>
                      {breakdown.length > 0 && (
                        <div className="mr-detail__bars">
                          <small className="mr-detail__bars-title">{t("match.breakdown")}</small>
                          {breakdown.map((row) => {
                            const tier = row.value >= 1.1 ? "is-high" : row.value < 0.9 ? "is-low" : "is-mid";
                            return (
                              <span className="mr-bar" key={row.label}>
                                <small>{row.label}</small>
                                <span className="mr-bar__track">
                                  <i className={tier} style={{ width: `${Math.max(4, (Math.abs(row.value) / peak) * 100)}%` }} />
                                </span>
                                <b className={tier}>{row.value.toFixed(2)}</b>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </div>

    <section className="mr-demo">
      <span className="mr-demo__icon" aria-hidden="true"><Film size={18} /></span>
      <div className="mr-demo__body">
        <small>{t("match.demoStatus")}</small>
        <strong className={`is-${result.demo.state}`}>{t(`match.demoState.${result.demo.state}`)}</strong>
        {result.demo.size_bytes > 0 && <small>{formatBytes(result.demo.size_bytes)}</small>}
        {result.demo.path && <code title={result.demo.path}>{result.demo.path}</code>}
      </div>
      <div className="mr-demo__actions">
        {result.demo.state === "ready" && result.demo.path && csgo && (
          <button className="mr-demo__play" disabled={demoBusy} onClick={playDemo}>
            {demoBusy ? <RotateCcw size={15} className="is-spinning" /> : <Play size={15} fill="currentColor" />}
            {t("match.playDemo")}
          </button>
        )}
        {result.demo.path && (
          <button className="mr-demo__folder" onClick={() => void openDemoFolder()}>
            <FolderOpen size={15} />
            {t("match.openDemoFolder")}
          </button>
        )}
      </div>
    </section>
  </div>;
}
