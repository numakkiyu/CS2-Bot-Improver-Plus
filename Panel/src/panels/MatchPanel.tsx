import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, ChevronDown, History, Play, RotateCcw, Shield, Swords, Users } from "lucide-react";
import { api, type MatchCatalog, type MatchResult, type PrepareMatchInput } from "../lib/api";
import { useT } from "../i18n";
import { useStore } from "../state/store";
import Toggle from "../components/Toggle";
import MatchResultView from "./MatchResultView";
import "./MatchPanel.css";
import mirageImage from "../assets/maps/mirage.webp";
import infernoImage from "../assets/maps/inferno.webp";
import dust2Image from "../assets/maps/dust2.webp";
import nukeImage from "../assets/maps/nuke.webp";
import ancientImage from "../assets/maps/ancient.webp";
import anubisImage from "../assets/maps/anubis.webp";
import trainImage from "../assets/maps/train.webp";
import overpassImage from "../assets/maps/overpass.webp";
import vertigoImage from "../assets/maps/vertigo.webp";
import cacheImage from "../assets/maps/cache.webp";

type Props = { onOpenInstallation?: () => void; onOpenHistory?: () => void };

const MAP_LABELS: Record<string, string> = {
  de_mirage: "MIRAGE", de_inferno: "INFERNO", de_dust2: "DUST II", de_nuke: "NUKE", de_ancient: "ANCIENT",
  de_anubis: "ANUBIS", de_train: "TRAIN", de_overpass: "OVERPASS", de_vertigo: "VERTIGO", de_cache: "CACHE",
};
const MAP_IMAGES: Record<string, string> = {
  de_mirage: mirageImage, de_inferno: infernoImage, de_dust2: dust2Image, de_nuke: nukeImage, de_ancient: ancientImage,
  de_anubis: anubisImage, de_train: trainImage, de_overpass: overpassImage, de_vertigo: vertigoImage, de_cache: cacheImage,
};

export default function MatchPanel({ onOpenInstallation, onOpenHistory }: Props) {
  const t = useT();
  const { directory, process, reportError } = useStore();
  const csgo = directory?.valid ? directory.selected : null;
  const [catalog, setCatalog] = useState<MatchCatalog | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [selectedMap, setSelectedMap] = useState("de_mirage");
  const [opponentKind, setOpponentKind] = useState<PrepareMatchInput["opponent_kind"]>("featured_team");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [side, setSide] = useState<PrepareMatchInput["player_side"]>("random");
  const [difficulty, setDifficulty] = useState<PrepareMatchInput["difficulty"]>(() => (localStorage.getItem("cs2bi.matchDifficulty") as PrepareMatchInput["difficulty"]) || "medium");
  const [recordDemo, setRecordDemo] = useState(localStorage.getItem("cs2bi.matchDemoV2") === "1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!csgo) return;
    void api.getMatchCatalog(csgo).then((value) => {
      setCatalog(value);
      setTeamId((current) => current && value.teams.some((team) => team.id === current) ? current : value.teams[0]?.id ?? null);
    }).catch(reportError);
    void api.getActiveMatch(csgo).then((active) => {
      if (active && (active.state === "finished" || active.state === "interrupted")) {
        void api.getMatchResult(csgo, active.session_id).then(setResult).catch(() => {});
      }
    }).catch(() => {});
  }, [csgo]);

  useEffect(() => {
    const promise = listen<MatchResult>("match-finished", (event) => {
      setResult(event.payload);
      setBusy(false);
    });
    return () => { void promise.then((dispose) => dispose()); };
  }, [csgo]);

  const selectedTeam = useMemo(() => catalog?.teams.find((team) => team.id === teamId) ?? null, [catalog, teamId]);
  const disabledReason = !csgo ? t("match.reasonDirectory") : process?.running ? t("match.reasonRunning") : !catalog ? t("match.reasonCatalog") : opponentKind === "featured_team" && !teamId ? t("match.reasonTeam") : null;

  const startMatch = async () => {
    if (!csgo || disabledReason) return;
    setBusy(true);
    localStorage.setItem("cs2bi.matchDifficulty", difficulty);
    localStorage.setItem("cs2bi.matchDemoV2", recordDemo ? "1" : "0");
    try {
      await api.prepareAndLaunchMatch(csgo, { schema_version: 1, map_id: selectedMap, player_side: side, difficulty, opponent_kind: opponentKind, opponent_team_id: opponentKind === "featured_team" ? teamId : null, record_demo: recordDemo });
    } catch (error) { setBusy(false); reportError(error); }
  };

  if (result) return <MatchResultView result={result} onClose={() => setResult(null)} t={t} />;

  return (
    <div className="match-page">
      <header className="workspace__head match-page__head">
        <div><span className="workspace__eyebrow">PLUS MATCH</span><h1>{t("match.title")}</h1><p>{t("match.subtitle")}</p></div>
        {onOpenHistory && <button className="match-history-button" onClick={onOpenHistory}><History size={16} />{t("match.history")}</button>}
      </header>
      <div className="match-layout">
        <section className="match-config glass">
          <div className="match-config__section"><span className="match-label">{t("match.opponent")}</span><div className="match-segment"><button className={opponentKind === "featured_team" ? "is-active" : ""} onClick={() => setOpponentKind("featured_team")}><Shield size={15} />{t("match.featured")}</button><button className={opponentKind === "random" ? "is-active" : ""} onClick={() => setOpponentKind("random")}><Users size={15} />{t("match.random")}</button></div></div>
          {opponentKind === "featured_team" ? <label className="match-field"><span>{t("match.team")}</span><span className="match-select"><select value={teamId ?? ""} onChange={(event) => setTeamId(event.target.value)}>{catalog?.teams.map((team) => <option value={team.id} key={team.id}>{team.ranking ? `#${team.ranking} ` : ""}{team.name}</option>)}</select><ChevronDown size={15} /></span></label> : <div className="match-random-note"><Swords size={16} /><span>{t("match.randomNote")}</span></div>}
          <div className="match-config__section"><span className="match-label">{t("match.side")}</span><div className="match-segment match-segment--three">{(["random", "ct", "t"] as const).map((value) => <button key={value} className={side === value ? "is-active" : ""} onClick={() => setSide(value)}>{value === "random" ? t("match.random") : value.toUpperCase()}</button>)}</div></div>
          <div className="match-config__section"><span className="match-label">{t("match.difficulty")}</span><div className="match-segment match-segment--three">{(["low", "medium", "high"] as const).map((value) => <button key={value} className={difficulty === value ? "is-active" : ""} onClick={() => setDifficulty(value)}>{t(`match.${value}` as never)}</button>)}</div></div>
          <div className="match-demo-row"><div><span className="match-label">{t("match.demo")}</span><small>{t("match.demoDesc")}</small></div><Toggle checked={recordDemo} onChange={setRecordDemo} ariaLabel={t("match.demo")} /></div>
          {recordDemo && <div className="match-demo-warning" role="alert"><AlertTriangle size={15} /><span>{t("match.demoWarning")}</span></div>}
          <div className="match-rules"><span>{t("match.rules")}</span><strong>5v5 · MR12</strong><small>{t("match.overtime")}</small></div>
          {disabledReason && <div className="match-disabled"><AlertTriangle size={15} /><span>{disabledReason}</span>{!csgo && onOpenInstallation && <button onClick={onOpenInstallation}>{t("match.openInstallation")}</button>}</div>}
          <button className="match-start" disabled={!!disabledReason || busy} onClick={startMatch}>{busy ? <RotateCcw className="is-spinning" size={17} /> : <Play size={17} fill="currentColor" />}{busy ? t("match.launching") : t("match.start")}</button>
        </section>
        <section className="match-maps"><div className="match-section-head"><div><span className="match-label">{t("match.mapPool")}</span><h2>{MAP_LABELS[selectedMap] ?? selectedMap}</h2></div><span className="match-map-count">{catalog?.maps.length ?? 10} {t("match.maps")}</span></div><div className="match-map-grid">{catalog?.maps.map((map) => <button key={map.id} className={`match-map-card ${selectedMap === map.id ? "is-selected" : ""}`} onClick={() => setSelectedMap(map.id)}><span className={`match-map-card__image map-${map.id.replace("de_", "")}`}><img src={MAP_IMAGES[map.id]} alt="" aria-hidden="true" /><span>{MAP_LABELS[map.id] ?? map.display_name}</span></span><span className="match-map-card__name">{map.display_name}</span><span className="match-map-card__check">{selectedMap === map.id ? "●" : "○"}</span></button>)}</div></section>
      </div>
      {selectedTeam && <div className="match-roster-hint"><span>{t("match.selectedRoster")}</span>{selectedTeam.players.map((player) => <span key={player}>{player}</span>)}</div>}
    </div>
  );
}
