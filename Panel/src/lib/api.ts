import { invoke } from "@tauri-apps/api/core";

/** Mirrors Rust `AppError` (error.rs). Codes are stable & not localized. */
export type AppError = {
  code: string;
  category: string;
  detail: string;
};

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "category" in e &&
    typeof (e as AppError).code === "string"
  );
}

/** Normalize any thrown value into an AppError so the UI always has a code. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;

  if (typeof e === "string") {
    try {
      const parsed: unknown = JSON.parse(e);
      if (isAppError(parsed)) return parsed;
    } catch {
      // Plain strings are valid Tauri rejection details.
    }
    return { code: "E1099", category: "internal", detail: e || "Unknown error" };
  }

  if (e instanceof Error) {
    return {
      code: "E1099",
      category: "internal",
      detail: `${e.name}: ${e.message}`,
    };
  }

  if (typeof e === "object" && e !== null && "message" in e) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") {
      return { code: "E1099", category: "internal", detail: message };
    }
  }

  let detail = "Unknown error";
  try {
    detail = JSON.stringify(e) || String(e);
  } catch {
    detail = String(e);
  }
  return {
    code: "E1099",
    category: "internal",
    detail,
  };
}

// ---- DTOs (mirror src-tauri) ----
export type DirectoryInfo = {
  candidates: string[];
  selected: string | null;
  valid: boolean;
  needs_choice: boolean;
  steam_found: boolean;
};

export type FilesReport = {
  ok: boolean;
  total: number;
  present: number;
  missing: string[];
  /** Wrong folder the plugin was extracted into, if detected. */
  misplaced: string | null;
};

export type DifficultyLevel = "Low" | "Medium" | "High";

export type DifficultyInfo = {
  current: DifficultyLevel | null;
  available: DifficultyLevel[];
  active_present: boolean;
  cs2_running: boolean;
};

export type BotItemKey = "skins" | "profiles" | "agents" | "music";

export type BotItemsState = {
  skins: boolean;
  profiles: boolean;
  agents: boolean;
  music: boolean;
  cfg_present: boolean;
  cs2_running: boolean;
};

export type AimValue = "head" | "mixed" | "body";
export type NadesValue = "max" | "more" | "normal" | "off";

export type PresetsState = {
  aim: AimValue | null;
  nades: NadesValue | null;
  cfg_present: boolean;
  cs2_running: boolean;
};

export type DropKnivesState = {
  bind_key: string;
  selected: number[];
  cfg_present: boolean;
  cs2_running: boolean;
};

export type KnifePreset = {
  paint: number;
  seed: number;
  wear: number;
  name_tag: string;
  stattrak_enabled: boolean;
  stattrak_count: number;
  souvenir_enabled?: boolean;
};

export type GlovePreset = {
  enabled: boolean;
  defindex: number;
  paint: number;
  seed: number;
  wear: number;
};

export type KnifeCustomizerConfig = {
  enabled: boolean;
  apply_to_human_players: boolean;
  apply_to_dropped_knives: boolean;
  apply_on_pickup: boolean;
  default_knife_defindex: number;
  presets: Record<string, KnifePreset>;
  gun_presets?: Record<string, KnifePreset>;
  music_kit_id?: number;
  glove: GlovePreset;
};

export type KnifeCustomizerState = {
  plugin_present: boolean;
  config_present: boolean;
  cs2_running: boolean;
  config: KnifeCustomizerConfig;
};

export type GameMode = "online" | "bots";

export type ModeInfo = {
  current: GameMode | null;
  online_present: boolean;
  bots_present: boolean;
  insecure: boolean;
  user_count: number;
  cs2_running: boolean;
  // CS2 running and the on-disk gameinfo.gi doesn't match the remembered mode
  // (the boot-time apply was skipped) — show the mode control yellow.
  pending: boolean;
};

export type LaunchResult = {
  options: string;
  insecure: boolean;
};

export type BotItems = {
  skins: boolean;
  profiles: boolean;
  agents: boolean;
  music: boolean;
};

export type AppConfig = {
  language: string | null;
  difficulty: string | null;
  mode: string | null;
  insecure: boolean;
  bot_items: BotItems;
  aim: string | null;
  nades: string | null;
  drop_knife_bind: string;
  drop_knife_subclasses: number[];
  csgo_path: string | null;
  first_run_done: boolean;
};

// ---- Command wrappers ----
export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
  detectDirectories: () => invoke<DirectoryInfo>("detect_directories"),
  selectDirectory: (path: string) =>
    invoke<DirectoryInfo>("select_directory", { path }),
  cleanupBackups: (csgo: string) => invoke<number>("cleanup_backups", { csgo }),
  validateFiles: (csgo: string) => invoke<FilesReport>("validate_files", { csgo }),
  getDifficulty: (csgo: string) => invoke<DifficultyInfo>("get_difficulty", { csgo }),
  setDifficulty: (csgo: string, level: DifficultyLevel) =>
    invoke<DifficultyInfo>("set_difficulty", { csgo, level }),
  getMode: (csgo: string) => invoke<ModeInfo>("get_mode", { csgo }),
  setMode: (csgo: string, mode: GameMode) =>
    invoke<ModeInfo>("set_mode", { csgo, mode }),
  reconcileLaunchOptions: () => invoke<number>("reconcile_launch_options"),
  launchCs2: () => invoke<LaunchResult>("launch_cs2"),
  reconcileCoreJson: (csgo: string) => invoke<void>("reconcile_core_json", { csgo }),
  getBotItems: (csgo: string) => invoke<BotItemsState>("get_bot_items", { csgo }),
  setBotItem: (csgo: string, item: BotItemKey, on: boolean) =>
    invoke<BotItemsState>("set_bot_item", { csgo, item, on }),
  getPresets: (csgo: string) => invoke<PresetsState>("get_presets", { csgo }),
  setAim: (csgo: string, value: AimValue) =>
    invoke<PresetsState>("set_aim", { csgo, value }),
  setNades: (csgo: string, value: NadesValue) =>
    invoke<PresetsState>("set_nades", { csgo, value }),
  getDropKnives: (csgo: string) =>
    invoke<DropKnivesState>("get_drop_knives", { csgo }),
  setDropKnives: (csgo: string, bindKey: string, selected: number[]) =>
    invoke<DropKnivesState>("set_drop_knives", { csgo, bindKey, selected }),
  getKnifeCustomizer: (csgo: string) =>
    invoke<KnifeCustomizerState>("get_knife_customizer", { csgo }),
  saveKnifeCustomizer: (csgo: string, config: KnifeCustomizerConfig) =>
    invoke<KnifeCustomizerState>("save_knife_customizer", { csgo, config }),
};
