import { useEffect, useState } from "react";
import type { CosmeticsTeam } from "../lib/api";
import "./CosmeticsTeamSwitch.css";

const STORAGE_KEY = "cs2bi.cosmeticsTeam";

function savedTeam(): CosmeticsTeam {
  return localStorage.getItem(STORAGE_KEY) === "t" ? "t" : "ct";
}

export function useCosmeticsTeam(): [CosmeticsTeam, (team: CosmeticsTeam) => void] {
  const [team, setTeam] = useState<CosmeticsTeam>(savedTeam);
  useEffect(() => localStorage.setItem(STORAGE_KEY, team), [team]);
  return [team, setTeam];
}

type Props = {
  value: CosmeticsTeam;
  onChange: (team: CosmeticsTeam) => void;
  ariaLabel: string;
  compact?: boolean;
};

export default function CosmeticsTeamSwitch({ value, onChange, ariaLabel, compact = false }: Props) {
  return (
    <div className={`team-switch ${compact ? "team-switch--compact" : ""}`} role="radiogroup" aria-label={ariaLabel}>
      {(["ct", "t"] as const).map((team) => (
        <button
          key={team}
          type="button"
          role="radio"
          aria-checked={value === team}
          className={`team-switch__option team-switch__option--${team} ${value === team ? "is-active" : ""}`}
          onClick={() => onChange(team)}
        >
          {team.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
