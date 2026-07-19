import { useCallback, useEffect, useState } from "react";
import { Clock3, Film, Trash2 } from "lucide-react";
import Modal from "../components/Modal";
import { api, type MatchResult, type MatchSession } from "../lib/api";
import { useT } from "../i18n";
import { useStore } from "../state/store";
import MatchResultView from "./MatchResultView";
import "./MatchPanel.css";

const MAP_LABELS: Record<string, string> = {
  de_mirage: "MIRAGE", de_inferno: "INFERNO", de_dust2: "DUST II", de_nuke: "NUKE", de_ancient: "ANCIENT",
  de_anubis: "ANUBIS", de_train: "TRAIN", de_overpass: "OVERPASS", de_vertigo: "VERTIGO", de_cache: "CACHE",
};

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
    try { setHistory(await api.listMatchHistory(csgo)); } catch (error) { reportError(error); }
  }, [csgo, reportError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openResult = async (session: MatchSession) => {
    if (!csgo || !session.result_path) return;
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

  if (result) return <MatchResultView result={result} onClose={() => setResult(null)} t={t} />;

  return <div className="match-page match-history-page">
    <header className="workspace__head match-page__head"><div><span className="workspace__eyebrow">PLUS MATCH</span><h1>{t("match.history")}</h1><p>{t("match.historySubtitle")}</p></div><span className="match-map-count">{history.length}</span></header>
    <section className="match-history"><div className="match-section-head"><div><span className="match-label">{t("match.history")}</span><h2>{t("match.recentMatches")}</h2></div></div>{history.length === 0 ? <div className="match-empty"><Clock3 size={19} /><span>{t("match.emptyHistory")}</span></div> : <div className="match-history-list">{history.map((session) => <div className="match-history-row" key={session.session_id} onClick={() => void openResult(session)}><span className={`match-history-status status-${session.state}`}>{session.state === "finished" ? "FIN" : session.state === "interrupted" ? "INT" : "..."}</span><span className="match-history-map">{MAP_LABELS[session.map_id] ?? session.map_id}</span><strong>{session.player_score}:{session.opponent_score}</strong><span className="match-history-opponent">{session.opponent_name}</span><span className="match-history-time">{formatTime(session.created_at_unix)}</span><span className="match-history-demo"><Film size={14} />{session.demo.state}</span><button className="match-history-delete" onClick={(event) => { event.stopPropagation(); setDeleteCandidate(session); }} aria-label={t("match.delete")}><Trash2 size={15} /></button></div>)}</div>}</section>
    <Modal open={!!deleteCandidate} title={t("match.delete")} onClose={() => setDeleteCandidate(null)} footer={<><button className="match-dialog-cancel" onClick={() => setDeleteCandidate(null)}>{t("common.cancel")}</button><button className="match-dialog-delete" onClick={() => void confirmDelete()}>{t("match.delete")}</button></>}><p className="match-dialog-copy">{t("match.confirmDelete")}</p></Modal>
  </div>;
}
