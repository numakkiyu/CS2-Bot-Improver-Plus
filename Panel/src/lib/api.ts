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

export type Cs2ProcessInfo = {
  running: boolean;
  pid: number | null;
  executable: string | null;
  path_accessible: boolean;
  matches_selected: boolean;
};

export type InstallationSource =
  | "clean"
  | "managed_plus"
  | "legacy_plus"
  | "upstream"
  | "mixed_unknown";

export type MigrationKind =
  | "fresh_install"
  | "managed_upgrade"
  | "adopt_legacy_plus"
  | "replace_upstream"
  | "blocked";

export type RestoreBaseline =
  | "steam_original"
  | "pre_migration"
  | "existing_record"
  | "none";

export type InstallationInspection = {
  installed: boolean;
  package_version: string | null;
  manifest_available: boolean;
  total: number;
  healthy: number;
  missing: string[];
  corrupt: string[];
  restore_available: boolean;
  backup_path: string | null;
  interrupted_transaction: boolean;
  source: InstallationSource;
  source_version: string | null;
  source_evidence: string[];
  migration_kind: MigrationKind;
  restore_baseline: RestoreBaseline;
  can_install: boolean;
};

export type InstallPlan = {
  package_version: string;
  target: string;
  total_files: number;
  new_files: number;
  overwritten_files: number;
  backup_path: string;
  required_target_bytes: number;
  available_target_bytes: number;
  required_backup_bytes: number;
  available_backup_bytes: number;
  writable: boolean;
  source: InstallationSource;
  source_version: string | null;
  source_evidence: string[];
  migration_kind: MigrationKind;
  restore_baseline: RestoreBaseline;
  can_install: boolean;
};

export type InstallTransactionResult = {
  package_version: string;
  installed_files: number;
  backup_path: string;
  repaired: boolean;
};

export type RestoreResult = {
  restored_files: number;
  removed_files: number;
  preserved_files: number;
  presets_backup: string | null;
  steam_verify_uri: string;
  result_kind: "restore_previous" | "pristine";
};

export type DiagnosticReport = {
  path: string;
  files_collected: number;
};

export type UiMemory = {
  schema_version: number;
  saved_at: number;
  entries: Record<string, string>;
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

export type CosmeticsTeam = "ct" | "t";

export type TeamCosmeticLoadout = {
  default_knife_defindex: number;
  knife_presets: Record<string, KnifePreset>;
  glove: GlovePreset;
  gun_presets: Record<string, KnifePreset>;
};

export type KnifeCustomizerConfig = {
  schema_version: 2;
  enabled: boolean;
  apply_to_human_players: boolean;
  apply_on_pickup: boolean;
  music_kit_id: number;
  loadouts: Record<CosmeticsTeam, TeamCosmeticLoadout>;
  shared_weapon_links: Record<string, boolean>;
};

export type KnifeCustomizerState = {
  plugin_present: boolean;
  config_present: boolean;
  cs2_running: boolean;
  config: KnifeCustomizerConfig;
};

export type GameMode = "online" | "preview" | "bots";

export type ModeInfo = {
  current: GameMode | null;
  online_present: boolean;
  preview_present: boolean;
  bots_present: boolean;
  layout_healthy: boolean;
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
  first_run_step?: string | null;
  cosmetics_enabled_before_online?: boolean | null;
  cosmetics_enabled_before_preview?: boolean | null;
};

export type UpdateComponentState = {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  compatible: boolean;
  status: string;
  downloaded_bytes: number;
  total_bytes: number;
  error: string | null;
};

export type OnlineUpdateSnapshot = {
  checked_at: number | null;
  release_version: string | null;
  release_notes_url: string | null;
  panel: UpdateComponentState;
  plugin: UpdateComponentState;
  busy: boolean;
  error: string | null;
};

export type UpdateProgress = {
  component: "panel" | "plugin";
  stage: string;
  downloaded_bytes: number;
  total_bytes: number;
};

export type UpdateResult = {
  component: "panel" | "plugin";
  version: string;
  installed: boolean;
  restart_required: boolean;
  rollback_succeeded: boolean | null;
  detail: string;
};

export type RuntimeSnapshot = {
  directory: DirectoryInfo;
  process: Cs2ProcessInfo;
  files: FilesReport | null;
  difficulty: DifficultyInfo | null;
  mode: ModeInfo | null;
  bot_items: BotItemsState | null;
  presets: PresetsState | null;
  drop_knives: DropKnivesState | null;
  installation: InstallationInspection | null;
};

// ---- Command wrappers ----
export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
  getPanelMemory: () => invoke<UiMemory>("get_panel_memory"),
  savePanelMemory: (entries: Record<string, string>) =>
    invoke<UiMemory>("save_panel_memory", { entries }),
  recordPanelError: (error: AppError, context: string) =>
    invoke<void>("record_panel_error", { error: { ...error, context } }),
  getRuntimeSnapshot: () => invoke<RuntimeSnapshot>("get_runtime_snapshot"),
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
  inspectInstallation: (csgo: string) =>
    invoke<InstallationInspection>("inspect_installation", { csgo }),
  getInstallPlan: (csgo: string) => invoke<InstallPlan>("get_install_plan", { csgo }),
  installPayload: (csgo: string) =>
    invoke<InstallTransactionResult>("install_payload", { csgo }),
  repairPayload: (csgo: string) =>
    invoke<InstallTransactionResult>("repair_payload", { csgo }),
  restorePayload: (csgo: string) => invoke<RestoreResult>("restore_payload", { csgo }),
  restorePristineCs2: (csgo: string) => invoke<RestoreResult>("restore_pristine_cs2", { csgo }),
  exportDiagnostics: (csgo: string | null) =>
    invoke<DiagnosticReport>("export_diagnostics", { csgo }),
  getUpdateSnapshot: () => invoke<OnlineUpdateSnapshot>("get_update_snapshot"),
  checkOnlineUpdates: (force: boolean) =>
    invoke<OnlineUpdateSnapshot>("check_online_updates", { force }),
  installPanelUpdate: () => invoke<UpdateResult>("install_panel_update"),
  installPluginUpdate: (csgo: string) =>
    invoke<UpdateResult>("install_plugin_update", { csgo }),
  cancelUpdate: () => invoke<void>("cancel_update"),
};
