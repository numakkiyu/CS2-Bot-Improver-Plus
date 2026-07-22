const CT_PLAYER_AVATARS = [
  "/player-avatars/agent-4619.png",
  "/player-avatars/agent-4711.png",
  "/player-avatars/agent-4712.png",
  "/player-avatars/agent-4757.png",
  "/player-avatars/agent-5308.png",
  "/player-avatars/agent-5405.png",
] as const;

const T_PLAYER_AVATARS = [
  "/player-avatars/agent-4613.png",
  "/player-avatars/agent-4730.png",
  "/player-avatars/agent-4732.png",
  "/player-avatars/agent-4776.png",
  "/player-avatars/agent-4777.png",
  "/player-avatars/agent-5106.png",
] as const;

function stableIndex(value: string, length: number) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

export function playerAvatarPath(name: string, team: "ct" | "t") {
  const avatars = team === "ct" ? CT_PLAYER_AVATARS : T_PLAYER_AVATARS;
  return avatars[stableIndex(name, avatars.length)];
}

export function assignPlayerAvatarPaths(
  players: readonly { player_id: string; name: string; team: "ct" | "t" }[],
) {
  const assignments = new Map<string, string>();

  for (const team of ["ct", "t"] as const) {
    const avatars = team === "ct" ? CT_PLAYER_AVATARS : T_PLAYER_AVATARS;
    const used = new Set<number>();
    const teammates = players
      .filter((player) => player.team === team)
      .sort((left, right) => {
        const leftKey = `${left.name}\0${left.player_id}`;
        const rightKey = `${right.name}\0${right.player_id}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });

    for (const player of teammates) {
      const start = stableIndex(`${player.name}\0${player.player_id}`, avatars.length);
      let selected = start;
      for (let offset = 0; offset < avatars.length; offset += 1) {
        const candidate = (start + offset) % avatars.length;
        if (!used.has(candidate)) {
          selected = candidate;
          break;
        }
      }
      used.add(selected);
      assignments.set(player.player_id, avatars[selected]);
    }
  }

  return assignments;
}

export function teamLogoPath(teamId: string) {
  return `/team-logos/${teamId}.png`;
}
