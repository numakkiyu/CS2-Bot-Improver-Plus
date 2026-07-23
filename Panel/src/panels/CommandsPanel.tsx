import { useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Crosshair,
  Gamepad2,
  Search,
  ShoppingCart,
  Terminal,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import SubPage from "../components/SubPage";
import { useToast } from "../components/Toast";
import { useT, type I18nKey } from "../i18n";
import { COMMANDS_TXT, TEAMS, type Team } from "../data/commands";
import { writeClipboard } from "../lib/platform";
import "./CommandsPanel.css";

type TabId = "common" | "bots" | "teams" | "buy" | "multiplayer";
type SectionId =
  | "GAME MODE"
  | "CONNECTION"
  | "BOT AIM STYLE"
  | "BOT NADE THROWING"
  | "BOT MANAGEMENT"
  | "COORDINATED BUY";
type Side = "ct" | "t";
type Icon = LucideIcon;

const SECTION_META: Record<
  SectionId,
  { title: I18nKey; description: I18nKey; icon: Icon }
> = {
  "GAME MODE": {
    title: "cmd.h.gameMode",
    description: "cmd.desc.gameMode",
    icon: Gamepad2,
  },
  CONNECTION: {
    title: "cmd.h.connection",
    description: "cmd.desc.connection",
    icon: Wifi,
  },
  "BOT AIM STYLE": {
    title: "cmd.h.aimStyle",
    description: "cmd.desc.aimStyle",
    icon: Crosshair,
  },
  "BOT NADE THROWING": {
    title: "cmd.h.nadeThrowing",
    description: "cmd.desc.nadeThrowing",
    icon: Bot,
  },
  "BOT MANAGEMENT": {
    title: "cmd.h.botManagement",
    description: "cmd.desc.botManagement",
    icon: Users,
  },
  "COORDINATED BUY": {
    title: "cmd.h.coordinatedBuy",
    description: "cmd.desc.coordinatedBuy",
    icon: ShoppingCart,
  },
};

const TABS: { id: TabId; label: I18nKey; icon: Icon }[] = [
  { id: "common", label: "cmd.tab.common", icon: Terminal },
  { id: "bots", label: "cmd.tab.bots", icon: Bot },
  { id: "teams", label: "cmd.tab.teams", icon: Users },
  { id: "buy", label: "cmd.tab.buy", icon: ShoppingCart },
  { id: "multiplayer", label: "cmd.tab.multiplayer", icon: Wifi },
];

const TAB_SECTIONS: Record<Exclude<TabId, "teams" | "multiplayer">, SectionId[]> = {
  common: ["GAME MODE", "CONNECTION"],
  bots: ["BOT AIM STYLE", "BOT NADE THROWING", "BOT MANAGEMENT"],
  buy: ["COORDINATED BUY"],
};

function parseSections(text: string): Record<SectionId, string[]> {
  const result: Record<SectionId, string[]> = {
    "GAME MODE": [],
    CONNECTION: [],
    "BOT AIM STYLE": [],
    "BOT NADE THROWING": [],
    "BOT MANAGEMENT": [],
    "COORDINATED BUY": [],
  };
  const headers = new Set(Object.keys(SECTION_META));
  let current: SectionId | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (headers.has(line)) {
      current = line as SectionId;
      continue;
    }
    if (line === "ADD TEAMS") {
      current = null;
      continue;
    }
    if (current && line) result[current].push(line);
  }
  return result;
}

const COMMAND_SECTIONS = parseSections(COMMANDS_TXT);

const COMMAND_DESCRIPTION_KEYS: Record<string, I18nKey> = {
  scouts_on: "cmd.detail.scoutsOn",
  scouts_off: "cmd.detail.scoutsOff",
  status: "cmd.detail.status",
  "bot_aim head": "cmd.detail.aimHead",
  "bot_aim body": "cmd.detail.aimBody",
  "bot_aim mixed": "cmd.detail.aimMixed",
  "bot_nades normal": "cmd.detail.nadesNormal",
  "bot_nades more": "cmd.detail.nadesMore",
  "bot_nades max": "cmd.detail.nadesMax",
  "bot_nades off": "cmd.detail.nadesOff",
  bot_kick: "cmd.detail.kickAll",
  "bot_kick t": "cmd.detail.kickT",
  "bot_kick ct": "cmd.detail.kickCt",
  "bot_kick <bot name>": "cmd.detail.kickNamed",
  bot_add: "cmd.detail.addAuto",
  "bot_add <bot name>": "cmd.detail.addNamed",
  bot_add_t: "cmd.detail.addT",
  bot_add_ct: "cmd.detail.addCt",
  "bot_add_t <bot name>": "cmd.detail.addTNamed",
  "bot_add_ct <bot name>": "cmd.detail.addCtNamed",
  "bot_randombuy 1": "cmd.detail.randomBuyOn",
  "bot_randombuy 0": "cmd.detail.randomBuyOff",
  bot_quota: "cmd.detail.quota",
  "mp_restartgame 1": "cmd.detail.restart",
  bot_buy: "cmd.detail.autoBuy",
};

const BUY_WEAPONS: Record<string, string> = {
  elite: "Dual Berettas",
  p250: "P250",
  fn57: "Five-SeveN",
  deagle: "Desert Eagle",
  cz75a: "CZ75-Auto",
  r8: "R8 Revolver",
  bizon: "PP-Bizon",
  p90: "P90",
  mp5sd: "MP5-SD",
  mp9: "MP9",
  mp7: "MP7",
  mac10: "MAC-10",
  ump45: "UMP-45",
  mag7: "MAG-7",
  sawedoff: "Sawed-Off",
  nova: "Nova",
  xm1014: "XM1014",
  famas: "FAMAS",
  galilar: "Galil AR",
  m4a1: "M4A4",
  m4a1s: "M4A1-S",
  ak47: "AK-47",
  aug: "AUG",
  sg556: "SG 553",
  ssg08: "SSG 08",
  awp: "AWP",
  scar20: "SCAR-20",
  g3sg1: "G3SG1",
  negev: "Negev",
  m249: "M249",
};

const PISTOL_LOADOUTS = new Set(["elite", "p250", "fn57", "deagle", "cz75a", "r8"]);

function commandDescription(
  command: string,
  t: ReturnType<typeof useT>
): string {
  const directKey = COMMAND_DESCRIPTION_KEYS[command];
  if (directKey) return t(directKey);

  const weapon = BUY_WEAPONS[command];
  if (weapon) {
    return t(
      PISTOL_LOADOUTS.has(command)
        ? "cmd.detail.pistolLoadout"
        : "cmd.detail.primaryLoadout",
      { weapon }
    );
  }

  return t("cmd.detail.fallback");
}

function CommandCard({
  command,
  description,
  icon: IconComponent,
  copied,
  onCopy,
}: {
  command: string;
  description: string;
  icon: Icon;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button className={`cmd-card ${copied ? "is-copied" : ""}`} onClick={onCopy}>
      <span className="cmd-card__icon" aria-hidden="true">
        <IconComponent size={17} strokeWidth={1.9} />
      </span>
      <span className="cmd-card__body">
        <span className="cmd-card__description">{description}</span>
        <code>{command}</code>
      </span>
      <span className="cmd-card__copy" aria-hidden="true">
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </span>
    </button>
  );
}

function TeamCard({
  team,
  side,
  copied,
  onSide,
  onCopy,
  copyLabel,
  playersLabel,
}: {
  team: Team;
  side: Side;
  copied: boolean;
  onSide: (side: Side) => void;
  onCopy: () => void;
  copyLabel: string;
  playersLabel: string;
}) {
  const command = side === "ct" ? team.ct : team.t;
  const keyboardCopy = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCopy();
    }
  };

  return (
    <div
      className={`team-card ${copied ? "is-copied" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onCopy}
      onKeyDown={keyboardCopy}
      aria-label={`${copyLabel}: ${team.name}`}
    >
      <div className="team-card__head">
        <span className="team-card__logo-wrap">
          <img className="team-card__logo" src={team.logo} alt="" />
        </span>
        <span className="team-card__identity">
          <strong>{team.name}</strong>
          <span>{playersLabel}</span>
        </span>
        <span className="team-card__copy" aria-hidden="true">
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </span>
      </div>

      <div className="team-card__players">
        {team.players.map((player) => (
          <span key={player}>{player}</span>
        ))}
      </div>

      <div className="team-card__footer">
        <div className="team-card__sides" aria-label="Side">
          {(["ct", "t"] as const).map((value) => (
            <button
              key={value}
              className={side === value ? "is-active" : ""}
              onClick={(event) => {
                event.stopPropagation();
                onSide(value);
              }}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
        <span className="team-card__source">Liquipedia</span>
      </div>
      <code className="team-card__command">{command}</code>
    </div>
  );
}

export default function CommandsPanel({ onBack }: { onBack?: () => void }) {
  const t = useT();
  const toast = useToast();
  const [tab, setTab] = useState<TabId>("common");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [teamSides, setTeamSides] = useState<Record<number, Side>>({});
  const copiedTimer = useRef<number | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const copy = async (id: string, value: string) => {
    try {
      await writeClipboard(value);
      setCopiedId(id);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedId(""), 900);
      toast.show(t("common.copied"), "green");
    } catch {
      toast.show(t("common.copyFailed"), "red");
    }
  };

  const filteredTeams = useMemo(() => {
    if (!normalizedQuery) return TEAMS;
    return TEAMS.filter((team) =>
      [team.name, ...team.players, team.ct, team.t]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [normalizedQuery]);

  const searchPlaceholder =
    tab === "teams" ? t("cmd.searchTeams") : t("cmd.searchCommands");

  const renderCommandSections = (
    sectionIds: SectionId[],
    queryValue: string
  ) => {
    const blocks = sectionIds
      .map((sectionId) => {
        const meta = SECTION_META[sectionId];
        const commands = COMMAND_SECTIONS[sectionId].filter((command) =>
          `${command} ${commandDescription(command, t)} ${t(meta.title)} ${t(meta.description)}`
            .toLowerCase()
            .includes(queryValue)
        );
        return { sectionId, meta, commands };
      })
      .filter((block) => block.commands.length > 0);

    if (!blocks.length) return <div className="cmd__empty">{t("cmd.noResults")}</div>;

    return blocks.map(({ sectionId, meta, commands }) => (
      <section className="cmd-group" key={sectionId}>
        <div className="cmd-group__heading">
          <span className="cmd-group__heading-icon">
            <meta.icon size={16} strokeWidth={1.9} />
          </span>
          <span>
            <strong>{t(meta.title)}</strong>
            <small>{t(meta.description)}</small>
          </span>
          <span className="cmd-group__count">{commands.length}</span>
        </div>
        <div className="cmd-grid">
          {commands.map((command) => {
            const id = `${sectionId}:${command}`;
            return (
              <CommandCard
                key={command}
                command={command}
                description={commandDescription(command, t)}
                icon={meta.icon}
                copied={copiedId === id}
                onCopy={() => copy(id, command)}
              />
            );
          })}
        </div>
      </section>
    ));
  };

  const multiplayerSteps = [
    {
      id: "status",
      number: "01",
      title: t("cmd.multi.statusTitle"),
      description: t("cmd.multi.statusDesc"),
      command: "status",
    },
    {
      id: "steamid",
      number: "02",
      title: t("cmd.multi.steamIdTitle"),
      description: t("cmd.multi.steamIdDesc"),
      command: "steamid",
    },
    {
      id: "connect",
      number: "03",
      title: t("cmd.multi.connectTitle"),
      description: t("cmd.multi.connectDesc"),
      command: "connect <steamid>",
    },
  ].filter((step) =>
    `${step.title} ${step.description} ${step.command}`
      .toLowerCase()
      .includes(normalizedQuery)
  );

  return (
    <SubPage title={t("cmd.title")} onBack={onBack}>
      <div className="cmd__toolbar">
        <div className="cmd__tabs" role="tablist" aria-label={t("cmd.categories")}>
          {TABS.map(({ id, label, icon: IconComponent }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "is-active" : ""}
              onClick={() => setTab(id)}
            >
              <IconComponent size={15} strokeWidth={2} />
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
        <label className="cmd__search-wrap">
          <Search size={16} aria-hidden="true" />
          <input
            className="cmd__search"
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="cmd__content selectable">
        {tab === "common" && renderCommandSections(TAB_SECTIONS.common, normalizedQuery)}
        {tab === "bots" && renderCommandSections(TAB_SECTIONS.bots, normalizedQuery)}
        {tab === "buy" && renderCommandSections(TAB_SECTIONS.buy, normalizedQuery)}

        {tab === "teams" && (
          <>
            <div className="cmd__section-intro">
              <span>
                <strong>{t("cmd.teamsTitle")}</strong>
                <small>{t("cmd.teamsDesc")}</small>
              </span>
              <span>{t("cmd.teamCount", { n: filteredTeams.length })}</span>
            </div>
            {filteredTeams.length ? (
              <div className="team-grid">
                {filteredTeams.map((team) => {
                  const side = teamSides[team.index] ?? "ct";
                  const id = `team:${team.index}:${side}`;
                  const command = side === "ct" ? team.ct : team.t;
                  return (
                    <TeamCard
                      key={team.index}
                      team={team}
                      side={side}
                      copied={copiedId === id}
                      onSide={(value) =>
                        setTeamSides((current) => ({ ...current, [team.index]: value }))
                      }
                      onCopy={() => copy(id, command)}
                      copyLabel={t("cmd.copyTeam")}
                      playersLabel={t("cmd.teamPlayers")}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="cmd__empty">{t("cmd.noResults")}</div>
            )}
          </>
        )}

        {tab === "multiplayer" && (
          <section className="multiplayer-guide">
            <div className="cmd__section-intro">
              <span>
                <strong>{t("cmd.multi.title")}</strong>
                <small>{t("cmd.multi.subtitle")}</small>
              </span>
            </div>
            {multiplayerSteps.length ? (
              <div className="multiplayer-guide__steps">
                {multiplayerSteps.map((step) => {
                  const id = `multi:${step.id}`;
                  return (
                    <button
                      key={step.id}
                      className={`multiplayer-step ${copiedId === id ? "is-copied" : ""}`}
                      onClick={() => copy(id, step.command)}
                    >
                      <span className="multiplayer-step__number">{step.number}</span>
                      <span className="multiplayer-step__body">
                        <strong>{step.title}</strong>
                        <small>{step.description}</small>
                        <code>{step.command}</code>
                      </span>
                      <span className="multiplayer-step__copy" aria-hidden="true">
                        {copiedId === id ? <Check size={17} /> : <Copy size={17} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="cmd__empty">{t("cmd.noResults")}</div>
            )}
            <div className="multiplayer-guide__note">
              <Terminal size={17} />
              <span>{t("cmd.multi.note")}</span>
            </div>
          </section>
        )}
      </div>
    </SubPage>
  );
}
