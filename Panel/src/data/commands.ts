import raw from "./commands.txt?raw";

/** Full Commands.txt text, bundled (Block 10 viewer reads this, not disk). */
export const COMMANDS_TXT: string = raw;

export type Team = {
  index: number;
  name: string;
  slug: string;
  logo: string;
  sourceUrl: string;
  players: string[];
  /** Full `bot_add_ct ...` console line. */
  ct: string;
  /** Full `bot_add_t ...` console line. */
  t: string;
};

const TEAM_META: Record<number, { slug: string; page: string }> = {
  1: { slug: "vitality", page: "Team_Vitality" },
  2: { slug: "furia", page: "FURIA" },
  3: { slug: "falcons", page: "Team_Falcons" },
  4: { slug: "mouz", page: "MOUZ" },
  5: { slug: "faze", page: "FaZe_Clan" },
  6: { slug: "mongolz", page: "The_MongolZ" },
  7: { slug: "navi", page: "Natus_Vincere" },
  8: { slug: "spirit", page: "Team_Spirit" },
  9: { slug: "g2", page: "G2_Esports" },
  10: { slug: "aurora", page: "Aurora_Gaming" },
  11: { slug: "b8", page: "B8" },
  12: { slug: "3dmax", page: "3DMAX" },
  13: { slug: "pain", page: "PaiN_Gaming" },
  14: { slug: "astralis", page: "Astralis" },
  15: { slug: "liquid", page: "Team_Liquid" },
  16: { slug: "passion-ua", page: "Passion_UA" },
  17: { slug: "legacy", page: "Legacy" },
  18: { slug: "imperial", page: "Imperial_Esports" },
  19: { slug: "parivision", page: "PARIVISION" },
  20: { slug: "m80", page: "M80" },
  21: { slug: "gamerlegion", page: "GamerLegion" },
  22: { slug: "virtus-pro", page: "Virtus.pro" },
  23: { slug: "nip", page: "Ninjas_in_Pyjamas" },
  24: { slug: "heroic", page: "HEROIC" },
  25: { slug: "lynn-vision", page: "Lynn_Vision_Gaming" },
  26: { slug: "nrg", page: "NRG" },
  27: { slug: "betboom", page: "BetBoom_Team" },
  28: { slug: "flyquest", page: "FlyQuest" },
  29: { slug: "fnatic", page: "Fnatic" },
  30: { slug: "tyloo", page: "TYLOO" },
  31: { slug: "fluxo", page: "Fluxo" },
  32: { slug: "9ine", page: "9INE" },
  33: { slug: "monte", page: "Monte" },
  34: { slug: "bestia", page: "BESTIA" },
  35: { slug: "ence", page: "ENCE" },
  36: { slug: "ecstatic", page: "ECSTATIC" },
  37: { slug: "rare-atom", page: "Rare_Atom" },
  38: { slug: "og", page: "OG" },
  39: { slug: "100-thieves", page: "100_Thieves" },
  40: { slug: "big", page: "BIG" },
};

function playersFrom(command: string): string[] {
  return Array.from(command.matchAll(/bot_add_(?:ct|t)\s+"([^"]+)"/g), (match) => match[1]);
}

/** Parse the "ADD TEAMS" .. "COORDINATED BUY" region into teams. */
function parseTeams(text: string): Team[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toUpperCase() === "ADD TEAMS");
  const endRel = lines
    .slice(start + 1)
    .findIndex((l) => l.trim().toUpperCase() === "COORDINATED BUY");
  const end = endRel === -1 ? lines.length : start + 1 + endRel;
  const region = start === -1 ? [] : lines.slice(start + 1, end);

  const teams: Team[] = [];
  let cur: Team | null = null;
  const header = /^\s*(\d+)\.\s*(.+?)\s*$/;

  for (const line of region) {
    const trimmed = line.trim();
    const m = trimmed.match(header);
    if (m) {
      cur = {
        index: parseInt(m[1], 10),
        name: m[2],
        slug: "",
        logo: "",
        sourceUrl: "",
        players: [],
        ct: "",
        t: "",
      };
      teams.push(cur);
      continue;
    }
    if (!cur) continue;
    if (trimmed.startsWith("bot_add_ct")) cur.ct = trimmed;
    else if (trimmed.startsWith("bot_add_t")) cur.t = trimmed;
  }

  return teams
    .filter((t) => t.name && (t.ct || t.t))
    .map((team) => {
      const meta = TEAM_META[team.index];
      const slug = meta?.slug ?? `team-${team.index}`;
      return {
        ...team,
        slug,
        logo: `/team-logos/${slug}.png`,
        sourceUrl: meta
          ? `https://liquipedia.net/counterstrike/${meta.page}`
          : "https://liquipedia.net/counterstrike/Main_Page",
        players: playersFrom(team.ct || team.t),
      };
    });
}

export const TEAMS: Team[] = parseTeams(raw);
