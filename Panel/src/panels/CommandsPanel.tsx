import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import SubPage from "../components/SubPage";
import { ChevronUp, ChevronDown } from "../components/icons";
import { useToast } from "../components/Toast";
import { useT, type I18nKey } from "../i18n";
import { COMMANDS_TXT } from "../data/commands";
import "./CommandsPanel.css";

// Section headers (only) are localized; commands / convars / team names stay English.
const HEADER_KEYS: Record<string, I18nKey> = {
  "GAME MODE": "cmd.h.gameMode",
  CONNECTION: "cmd.h.connection",
  "BOT AIM STYLE": "cmd.h.aimStyle",
  "BOT NADE THROWING": "cmd.h.nadeThrowing",
  "BOT MANAGEMENT": "cmd.h.botManagement",
  "ADD TEAMS": "cmd.h.addTeams",
  "COORDINATED BUY": "cmd.h.coordinatedBuy",
};

// BOT MANAGEMENT commands that take a trailing argument: copy/select keeps one
// trailing space so a name/number can be appended. The command itself stays
// English; only the bracketed placeholder hint (when present) is localized.
const TRAILING_SPACE = new Set([
  "bot_kick",
  "bot_kick t",
  "bot_kick ct",
  "bot_add",
  "bot_add_t",
  "bot_add_ct",
  "bot_quota",
]);
// Commands that also show a localized, non-selectable placeholder hint.
const HINT_KEY: Record<string, I18nKey> = {
  bot_kick: "cmd.hint.botName",
  bot_add: "cmd.hint.botName",
  bot_quota: "cmd.hint.number",
};

type RLine = {
  /** Visible text used for search matching and plain rendering. */
  display: string;
  /** Text written to the clipboard on click (no trim — trailing space kept). */
  copy: string;
  /** Selectable command portion (incl. trailing space) for special lines. */
  cmd?: string;
  /** Non-selectable localized placeholder, e.g. "[bot name]". */
  hint?: string;
  /** Clickable to copy: every line except localized section headers / blanks. */
  copyable: boolean;
};

function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i <= text.length) {
    const idx = lower.indexOf(ql, i);
    if (idx < 0) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark key={k++} className="cmd__hl">
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    i = idx + q.length;
  }
  return out;
}

export default function CommandsPanel({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0); // index into match list
  const listRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  // True when the selected match should be centred once on the next layout —
  // set by the up/down buttons (or arrow/enter) and by a query change.
  const centerOnNext = useRef(false);
  const prevQuery = useRef(query);
  const toast = useToast();
  // Index of the line that just played the copy flash (Apple-blue pulse).
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    []
  );

  // Build the rendered model: localize headers, and split the special bot
  // commands into a selectable command part (with trailing space) + a
  // non-selectable localized placeholder hint.
  const rendered = useMemo<RLine[]>(
    () =>
      COMMANDS_TXT.split("\n").map((raw) => {
        const trimmed = raw.trim();
        const headerKey = HEADER_KEYS[trimmed.toUpperCase()];
        // Localized section headers and blank lines are not copyable.
        if (headerKey) return { display: t(headerKey), copy: trimmed, copyable: false };
        if (trimmed === "") return { display: raw, copy: "", copyable: false };
        if (TRAILING_SPACE.has(trimmed)) {
          const cmd = trimmed + " ";
          const hk = HINT_KEY[trimmed];
          const hint = hk ? `[${t(hk)}]` : undefined;
          return { display: cmd + (hint ?? ""), copy: cmd, cmd, hint, copyable: true };
        }
        // Team name rows ("1.Team Vitality", "3. Falcons") copy the name only,
        // dropping the leading "N." index; the index still shows in the list.
        const team = trimmed.match(/^\d+\.\s*(.+)$/);
        if (team) return { display: raw, copy: team[1].trim(), copyable: true };
        return { display: raw, copy: trimmed, copyable: true };
      }),
    [t]
  );

  // Copy a line's command text to the clipboard (trailing space preserved).
  const copyLine = async (i: number) => {
    const text = rendered[i]?.copy ?? "";
    if (!text) return;
    try {
      await writeText(text);
      // Re-trigger the flash even on the same line by clearing first.
      setCopiedIdx(-1);
      requestAnimationFrame(() => setCopiedIdx(i));
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedIdx(-1), 600);
      toast.show(t("common.copied"), "green");
    } catch {
      toast.show(t("common.copyFailed"), "red");
    }
  };

  // Line indices matching the query.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as number[];
    return rendered.reduce<number[]>((acc, l, i) => {
      if (l.display.toLowerCase().includes(q)) acc.push(i);
      return acc;
    }, []);
  }, [rendered, query]);

  // On a query change (including empty → typed), reset to the first match and
  // request a one-time centre of it. Done during render — not in an effect — so
  // `current` is already 0 on the first commit, avoiding a one-frame scroll to a
  // previously-navigated selection.
  if (prevQuery.current !== query) {
    prevQuery.current = query;
    setCurrent(0);
    centerOnNext.current = true;
  }

  // Keep the selected match in view by scrolling ONLY the list box — never
  // scrollIntoView, which would also scroll ancestor containers/the page and
  // push the title bar out of view. When a centre was requested (navigation or a
  // query change) centre the match within the list (clamped to the list's own
  // scroll range, so matches near the top/bottom that can't be centred just stay
  // put); otherwise nudge it the minimum amount only if it's out of view.
  useEffect(() => {
    const list = listRef.current;
    const sel = selRef.current;
    if (list && sel) {
      const lr = list.getBoundingClientRect();
      const sr = sel.getBoundingClientRect();
      const max = list.scrollHeight - list.clientHeight;
      let top = list.scrollTop;
      if (centerOnNext.current) {
        top = list.scrollTop + (sr.top - lr.top) - (list.clientHeight - sr.height) / 2;
      } else if (sr.top < lr.top) {
        top = list.scrollTop + (sr.top - lr.top);
      } else if (sr.bottom > lr.bottom) {
        top = list.scrollTop + (sr.bottom - lr.bottom);
      }
      list.scrollTop = Math.max(0, Math.min(top, max));
    }
    centerOnNext.current = false;
  }, [current, matches]);

  const selectedLine = matches.length ? matches[Math.min(current, matches.length - 1)] : -1;

  const goNext = () => {
    if (!matches.length) return;
    centerOnNext.current = true;
    setCurrent((c) => (c + 1) % matches.length);
  };
  const goPrev = () => {
    if (!matches.length) return;
    centerOnNext.current = true;
    setCurrent((c) => (c - 1 + matches.length) % matches.length);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!matches.length) return;
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      goNext();
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      goPrev();
    }
  };

  const matchSet = useMemo(() => new Set(matches), [matches]);
  const hasMatches = matches.length > 0;
  const q = query.trim();

  return (
    <SubPage title={t("cmd.title")} onBack={onBack}>
      <div className="cmd__searchbar">
        <input
          className="cmd__search"
          type="text"
          value={query}
          placeholder={t("cmd.search")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        {query && (
          <span className="cmd__count">
            {hasMatches ? `${current + 1}/${matches.length}` : "0"}
          </span>
        )}
        <button
          className="cmd__nav"
          onClick={goPrev}
          disabled={!hasMatches}
          aria-label="Previous match"
          title="Previous (Shift+Enter)"
        >
          <ChevronUp size={16} />
        </button>
        <button
          className="cmd__nav"
          onClick={goNext}
          disabled={!hasMatches}
          aria-label="Next match"
          title="Next (Enter)"
        >
          <ChevronDown size={16} />
        </button>
      </div>
      <div className="cmd__list selectable" ref={listRef}>
        {rendered.map((r, i) => {
          const isMatch = matchSet.has(i);
          const isSel = i === selectedLine;
          const blank = r.display.trim() === "";
          const isCopied = copiedIdx === i;
          return (
            <div
              key={i}
              ref={isSel ? selRef : undefined}
              className={`cmd__line ${blank ? "is-blank" : ""} ${
                isMatch ? "is-match" : ""
              } ${isSel ? "is-selected" : ""} ${
                r.copyable ? "is-clickable" : ""
              } ${isCopied ? "is-copied" : ""}`}
              onClick={r.copyable ? () => copyLine(i) : undefined}
            >
              {r.cmd !== undefined ? (
                <>
                  <span>{q && isMatch ? highlight(r.cmd, q) : r.cmd}</span>
                  {r.hint && <span className="cmd__ph">{r.hint}</span>}
                </>
              ) : q && isMatch ? (
                highlight(r.display, q)
              ) : (
                r.display || " "
              )}
            </div>
          );
        })}
      </div>
    </SubPage>
  );
}
