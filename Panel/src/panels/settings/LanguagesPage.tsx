import { useStore } from "../../state/store";
import { LANGUAGES } from "../../data/languages";
import { Check } from "lucide-react";

export default function LanguagesPage() {
  const { config, updateConfig } = useStore();
  const current = config?.language ?? null;

  return (
    <div className="language-list" role="listbox" aria-label="Languages">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          className={`language-row ${current === l.code ? "is-selected" : ""}`}
          onClick={() => updateConfig({ language: l.code })}
          role="option"
          aria-selected={current === l.code}
        >
          <span className="language-row__name">{l.native}</span>
          <code>{l.short}</code>
          <span className="language-row__check" aria-hidden="true">
            {current === l.code && <Check size={16} strokeWidth={2.2} />}
          </span>
        </button>
      ))}
    </div>
  );
}
