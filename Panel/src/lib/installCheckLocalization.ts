import type { I18nKey, TParams } from "../i18n";
import type { InstallCheckItem } from "./api";

type Translate = (key: I18nKey, params?: TParams) => string;

const TITLE_KEYS: Partial<Record<string, I18nKey>> = {
  INSTALL_TARGET: "install.checkTitle.directory",
  STEAM_APP_730: "install.checkTitle.steamApp",
  STEAM_APP_ACTIVITY: "install.checkTitle.steamActivity",
  GAMEINFO_GI: "install.checkTitle.gameInfo",
  MATCH_MAP: "install.checkTitle.matchMap",
  CS2_PROCESS_LOCK: "install.checkTitle.processLock",
  TARGET_ATOMIC_WRITE: "install.checkTitle.targetWrite",
  MATCH_STATE_ATOMIC_WRITE: "install.checkTitle.matchWrite",
  PANEL_STATE_ATOMIC_WRITE: "install.checkTitle.panelWrite",
  TARGET_DISK_SPACE: "install.checkTitle.targetSpace",
  BACKUP_DISK_SPACE: "install.checkTitle.backupSpace",
  INSTALL_SPACE_PLAN: "install.checkTitle.spacePlan",
  PAYLOAD_HASHES: "install.checkTitle.payload",
  TRANSACTION_JOURNAL: "install.checkTitle.journal",
  BACKUP_READABLE: "install.checkTitle.backup",
  INSTALL_RECORD: "install.checkTitle.record",
};

const COMPONENT_KEYS: Partial<Record<string, I18nKey>> = {
  MATCH_CATALOG: "install.checkComponent.catalog",
  OPEN_RATING_MODEL: "install.checkComponent.rating",
  MATCH_PROFILE_LOW: "install.checkComponent.profileLow",
  MATCH_PROFILE_MEDIUM: "install.checkComponent.profileMedium",
  MATCH_PROFILE_HIGH: "install.checkComponent.profileHigh",
};

const COMPONENT_NAMES: Partial<Record<string, string>> = {
  METAMOD_X64: "MetaMod",
  CSS_X64: "CounterStrikeSharp",
  CSS_DOTNET_X64: "CounterStrikeSharp .NET runtime",
  RAYTRACE_X64: "RayTrace",
  BOTHIDER_X64: "BotHider",
  MATCH_COORDINATOR_MANAGED: "PlusMatchCoordinator",
  MATCH_CORE_MANAGED: "MatchCore",
};

function componentName(code: string, t: Translate): string | null {
  const normalized = code.replace(/^(TARGET|PAYLOAD)_/, "");
  const key = COMPONENT_KEYS[normalized];
  return key ? t(key) : COMPONENT_NAMES[normalized] ?? null;
}

function failureKeys(check: InstallCheckItem): [I18nKey, I18nKey] | null {
  switch (check.code) {
    case "INSTALL_TARGET": return ["install.checkCause.directory", "install.checkAction.directory"];
    case "STEAM_APP_730": return ["install.checkCause.steamApp", "install.checkAction.steamApp"];
    case "STEAM_APP_ACTIVITY": return ["install.checkCause.steamActivity", "install.checkAction.steamActivity"];
    case "GAMEINFO_GI":
    case "MATCH_MAP": return ["install.checkCause.gameFile", "install.checkAction.gameFile"];
    case "CS2_PROCESS_LOCK": return ["install.checkCause.processLock", "install.checkAction.processLock"];
    case "TARGET_ATOMIC_WRITE":
    case "MATCH_STATE_ATOMIC_WRITE":
    case "PANEL_STATE_ATOMIC_WRITE": return ["install.checkCause.write", "install.checkAction.write"];
    case "TARGET_DISK_SPACE":
    case "BACKUP_DISK_SPACE": return ["install.checkCause.space", "install.checkAction.space"];
    case "INSTALL_SPACE_PLAN": return ["install.checkCause.spacePlan", "install.checkAction.spacePlan"];
    case "PAYLOAD_HASHES": return ["install.checkCause.payload", "install.checkAction.payload"];
    case "TRANSACTION_JOURNAL": return ["install.checkCause.journal", "install.checkAction.journal"];
    case "BACKUP_READABLE": return ["install.checkCause.backup", "install.checkAction.backup"];
    case "INSTALL_RECORD": return ["install.checkCause.record", "install.checkAction.record"];
    default:
      if (check.code.startsWith("PAYLOAD_"))
        return ["install.checkCause.packageComponent", "install.checkAction.packageComponent"];
      if (check.code.startsWith("TARGET_"))
        return check.status === "warn"
          ? ["install.checkCause.targetPending", "install.checkAction.targetPending"]
          : ["install.checkCause.targetComponent", "install.checkAction.targetComponent"];
      return null;
  }
}

export function localizeInstallCheck(check: InstallCheckItem, t: Translate) {
  const fixedTitle = TITLE_KEYS[check.code];
  const name = componentName(check.code, t);
  const title = fixedTitle
    ? t(fixedTitle)
    : name
      ? t(check.code.startsWith("PAYLOAD_") ? "install.checkTitle.packageComponent" : "install.checkTitle.installedComponent", { name })
      : check.title;
  const keys = check.status === "pass" ? null : failureKeys(check);
  return {
    title,
    cause: keys ? t(keys[0]) : check.cause,
    action: keys ? t(keys[1]) : check.action,
  };
}
