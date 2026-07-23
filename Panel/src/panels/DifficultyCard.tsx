import { useState } from "react";
import Card from "../components/Card";
import Segmented from "../components/Segmented";
import { useToast } from "../components/Toast";
import { useStore } from "../state/store";
import { useT, type I18nKey } from "../i18n";
import type { DifficultyLevel } from "../lib/api";

const LEVELS: { value: DifficultyLevel; labelKey: I18nKey; descriptionKey: I18nKey }[] = [
  { value: "Low", labelKey: "diff.low", descriptionKey: "diff.lowDesc" },
  { value: "Medium", labelKey: "diff.medium", descriptionKey: "diff.mediumDesc" },
  { value: "High", labelKey: "diff.high", descriptionKey: "diff.highDesc" },
];

export default function DifficultyCard() {
  const { difficulty, config, csgoPath, applyDifficulty } = useStore();
  const toast = useToast();
  const t = useT();
  const [pending, setPending] = useState<DifficultyLevel | null>(null);

  // Optimistic: show the clicked level immediately, revert if the swap fails.
  // On-disk detection wins; fall back to remembered, then default Medium.
  const current: DifficultyLevel =
    pending ??
    difficulty?.current ??
    ((config?.difficulty as DifficultyLevel | null) ?? "Medium");
  const currentLevel = LEVELS.find(({ value }) => value === current) ?? LEVELS[1];

  const onChange = async (level: DifficultyLevel) => {
    setPending(level);
    const info = await applyDifficulty(level);
    setPending(null);
    if (!info) return;
    if (info.cs2_running) {
      toast.show(t("common.restart"), "neutral");
    } else {
      const selected = LEVELS.find(({ value }) => value === level) ?? LEVELS[1];
      toast.show(`${t("diff.title")}: ${t(selected.labelKey)}`, "green");
    }
  };

  return (
    <Card title={t("diff.title")}>
      <Segmented
        ariaLabel={t("diff.title")}
        value={current}
        onChange={onChange}
        disabled={!csgoPath}
        options={LEVELS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
      />
      <p className="selection-detail" aria-live="polite">
        {t(currentLevel.descriptionKey)}
      </p>
    </Card>
  );
}
