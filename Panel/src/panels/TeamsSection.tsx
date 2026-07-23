import { useState } from "react";
import Collapsible from "../components/Collapsible";
import Dropdown from "../components/Dropdown";
import Segmented from "../components/Segmented";
import { CopyIcon } from "../components/icons";
import { writeClipboard } from "../lib/platform";
import { useToast } from "../components/Toast";
import { useT } from "../i18n";
import { TEAMS } from "../data/commands";
import "./TeamsSection.css";

type Side = "ct" | "t";

export default function TeamsSection() {
  const toast = useToast();
  const t = useT();
  const [teamIdx, setTeamIdx] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>(null);

  const team = TEAMS.find((t) => String(t.index) === teamIdx) ?? null;
  const canCopy = !!team && !!side;

  const copy = async () => {
    if (!team || !side) return;
    const segment = side === "ct" ? team.ct : team.t;
    if (!segment) {
      toast.show(t("common.nothingToCopy"), "red");
      return;
    }
    try {
      await writeClipboard(segment);
      toast.show(t("common.copied"), "green");
    } catch {
      toast.show(t("common.copyFailed"), "red");
    }
  };

  return (
    <Collapsible title={t("pre.teams")}>
      <div className="teams">
        <Dropdown
          ariaLabel={t("pre.team")}
          placeholder={t("pre.team")}
          value={teamIdx}
          onChange={setTeamIdx}
          options={TEAMS.map((t) => ({ value: String(t.index), label: t.name }))}
        />
        <Segmented
          ariaLabel="Side"
          value={side}
          onChange={setSide}
          options={[
            { value: "ct", label: "CT" },
            { value: "t", label: "T" },
          ]}
        />
        <button className="teams__copy" disabled={!canCopy} onClick={copy}>
          <CopyIcon size={16} />
          <span>{t("pre.copy")}</span>
        </button>
      </div>
    </Collapsible>
  );
}
