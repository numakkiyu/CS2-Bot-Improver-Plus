import Toggle, { type Tone } from "../components/Toggle";
import SubPage from "../components/SubPage";
import Card from "../components/Card";
import { useStore } from "../state/store";
import { useT, type I18nKey } from "../i18n";
import type { Status } from "../components/StatusDot";
import type { BotItemKey } from "../lib/api";
import "./BotItemsPanel.css";

const ITEMS: { key: BotItemKey; labelKey: I18nKey }[] = [
  { key: "skins", labelKey: "bi.skins" },
  { key: "profiles", labelKey: "bi.profiles" },
  { key: "agents", labelKey: "bi.agents" },
  { key: "music", labelKey: "bi.music" },
];

export default function BotItemsPanel({ onBack }: { onBack?: () => void }) {
  const { botItems, csgoPath, applyBotItem, botItemsPending } = useStore();
  const t = useT();

  const cfgPresent = botItems?.cfg_present ?? false;
  const running = botItems?.cs2_running ?? false;
  // Each item is yellow only if *that* item was changed while CS2 is running.
  const itemYellow = (key: BotItemKey) => running && botItemsPending[key];
  // The header light is yellow if any single item is pending a restart.
  const anyYellow = running && ITEMS.some(({ key }) => botItemsPending[key]);

  const headStatus: Status = !csgoPath
    ? "off"
    : !cfgPresent
    ? "red"
    : anyYellow
    ? "yellow"
    : "green";

  return (
    <SubPage title={t("bi.title")} onBack={onBack} status={headStatus}>
      <Card>
        <div className="botitems-grid">
          {ITEMS.map(({ key, labelKey }) => {
            const on = (botItems?.[key] as boolean | undefined) ?? false;
            const tone: Tone = !cfgPresent
              ? "red"
              : itemYellow(key)
              ? "yellow"
              : "green";
            return (
              <div className="botitem" key={key}>
                <span className="botitem__label">{t(labelKey)}</span>
                <Toggle
                  ariaLabel={t(labelKey)}
                  checked={on}
                  tone={tone}
                  disabled={!csgoPath || !cfgPresent}
                  onChange={(next) => applyBotItem(key, next)}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </SubPage>
  );
}
