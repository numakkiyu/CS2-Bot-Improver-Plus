import { APP_DISPLAY_VERSION } from "./version";
import { BROWSER_DEMO_CSGO_PATH, dispatchBrowserEvent } from "./platform";
import type {
  AppConfig,
  BotItemKey,
  BotItemsState,
  CosmeticsPresetImportResult,
  DifficultyInfo,
  DifficultyLevel,
  DropKnivesState,
  FilesReport,
  GameMode,
  InstallCheckReport,
  InstallationInspection,
  KnifeCustomizerConfig,
  KnifeCustomizerState,
  MatchCatalog,
  MatchPlayer,
  MatchRequest,
  MatchResult,
  MatchSession,
  ModeInfo,
  OnlineUpdateSnapshot,
  PlayerMatchStats,
  PrepareMatchInput,
  PresetsState,
  RuntimeSnapshot,
  UiMemory,
} from "./api";

const STORAGE_KEY = "cs2bip-browser-demo-v1";

type BrowserMockState = {
  schema: 1;
  config: AppConfig;
  memory: UiMemory;
  directory: RuntimeSnapshot["directory"];
  files: FilesReport;
  installation: InstallationInspection;
  difficulty: DifficultyInfo;
  mode: ModeInfo;
  botItems: BotItemsState;
  presets: PresetsState;
  dropKnives: DropKnivesState;
  cosmetics: KnifeCustomizerConfig;
  updates: OnlineUpdateSnapshot;
  activeMatch: MatchSession | null;
  history: MatchSession[];
  results: Record<string, MatchResult>;
};

function preset(paint: number) {
  return {
    paint,
    seed: 0,
    wear: 0.03,
    name_tag: "",
    stattrak_enabled: false,
    stattrak_count: 0,
    souvenir_enabled: false,
    stickers: [],
  };
}

function defaultCosmetics(): KnifeCustomizerConfig {
  const glove = { enabled: false, defindex: 5030, paint: 10048, seed: 0, wear: 0.01 };
  const awp = preset(344);
  return {
    schema_version: 3,
    enabled: true,
    apply_to_human_players: true,
    apply_on_pickup: true,
    music_kit_id: 0,
    stickers_enabled: false,
    loadouts: {
      ct: {
        default_knife_defindex: 515,
        knife_presets: { "515": preset(568) },
        glove: { ...glove },
        gun_presets: { "9": { ...awp }, "16": preset(309) },
      },
      t: {
        default_knife_defindex: 515,
        knife_presets: { "515": preset(568) },
        glove: { ...glove },
        gun_presets: { "7": preset(661), "9": { ...awp } },
      },
    },
    shared_weapon_links: { "9": true },
  };
}

function mockPlayerStats(name: string, team: "ct" | "t", index: number, local = false): PlayerMatchStats {
  const kills = 22 - index;
  const deaths = 13 + index;
  const rounds = 21;
  return {
    player_id: local ? "local-player" : `${team}-${index}`,
    name,
    kind: local ? "human" : "bot",
    team,
    kills,
    deaths,
    assists: 4 + (index % 4),
    headshots: 8 + (index % 5),
    damage: 1800 - index * 70,
    rounds_played: rounds,
    rounds_survived: 8,
    kast_rounds: 15,
    first_kills: 3,
    first_deaths: 2,
    mvps: 2,
    clutches: 1,
    trade_kills: 3,
    trade_denials: 1,
    failed_trades: 1,
    ct_kills: Math.ceil(kills / 2),
    t_kills: Math.floor(kills / 2),
    round_swing: 1.2,
    economy_adjustment: 0.1,
    multi_kills: { "2": 3, "3": 1 },
    rating: {
      model_version: "open-rating-3.0-proxy-v1",
      kills: 1.1,
      damage: 1.05,
      survival: 1.0,
      kast: 1.08,
      multi_kills: 1.04,
      round_swing: 1.02,
      economy_adjustment: 0.01,
      open_rating: 1.12 - index * 0.02,
    },
    difference: kills - deaths,
    adr: (1800 - index * 70) / rounds,
    kast_percent: (15 / rounds) * 100,
    headshot_percent: ((8 + (index % 5)) / kills) * 100,
  };
}

function completedMatch(sessionId = "browser-demo-match"): MatchResult {
  const names = ["Player", "Atlas", "Bolt", "Cipher", "Drift", "Nova", "Rook", "Vega", "Kite", "Echo"];
  return {
    schema_version: 1,
    session_id: sessionId,
    state: "finished",
    map_id: "de_mirage",
    started_at_unix: Math.floor(Date.now() / 1000) - 1800,
    finished_at_unix: Math.floor(Date.now() / 1000) - 300,
    player_score: 13,
    opponent_score: 8,
    opponent_name: "Browser Demo Five",
    rating_model_version: "open-rating-3.0-proxy-v1",
    demo: { state: "disabled", path: null, size_bytes: 0, error_code: null, detail: null },
    players: names.map((name, index) => mockPlayerStats(name, index < 5 ? "ct" : "t", index, index === 0)),
    interruption_reason: null,
  };
}

function sessionFromResult(result: MatchResult): MatchSession {
  return {
    schema_version: result.schema_version,
    session_id: result.session_id,
    state: result.state,
    map_id: result.map_id,
    opponent_name: result.opponent_name,
    created_at_unix: result.started_at_unix,
    player_score: result.player_score,
    opponent_score: result.opponent_score,
    demo: result.demo,
    result_path: `C:\\CS2 Browser Demo\\matches\\${result.session_id}.json`,
  };
}

function defaultState(): BrowserMockState {
  const result = completedMatch();
  const now = Math.floor(Date.now() / 1000);
  return {
    schema: 1,
    config: {
      language: localStorage.getItem("cs2bi.language") || "schinese",
      difficulty: "Medium",
      mode: "bots",
      insecure: true,
      bot_items: { skins: true, profiles: true, agents: true, music: true },
      aim: "mixed",
      nades: "normal",
      drop_knife_bind: "MOUSE4",
      drop_knife_subclasses: [515, 507],
      csgo_path: BROWSER_DEMO_CSGO_PATH,
      first_run_done: true,
      first_run_step: null,
      experimental_features_enabled: false,
      experimental_stickers_enabled: false,
    },
    memory: { schema_version: 1, saved_at: now, entries: {} },
    directory: {
      candidates: [BROWSER_DEMO_CSGO_PATH],
      selected: BROWSER_DEMO_CSGO_PATH,
      valid: true,
      needs_choice: false,
      steam_found: true,
    },
    files: { ok: true, total: 42, present: 42, missing: [], misplaced: null },
    installation: {
      installed: true,
      package_version: APP_DISPLAY_VERSION,
      manifest_available: true,
      total: 42,
      healthy: 42,
      missing: [],
      corrupt: [],
      restore_available: true,
      backup_path: "C:\\CS2 Browser Demo\\backups\\preview",
      interrupted_transaction: false,
      source: "managed_plus",
      source_version: APP_DISPLAY_VERSION,
      source_evidence: ["Browser demo state"],
      migration_kind: "managed_upgrade",
      restore_baseline: "existing_record",
      can_install: true,
    },
    difficulty: { current: "Medium", available: ["Low", "Medium", "High"], active_present: true, cs2_running: false },
    mode: { current: "bots", online_present: true, preview_present: true, bots_present: true, layout_healthy: true, insecure: true, user_count: 0, cs2_running: false, pending: false },
    botItems: { skins: true, profiles: true, agents: true, music: true, cfg_present: true, cs2_running: false },
    presets: { aim: "mixed", nades: "normal", cfg_present: true, cs2_running: false },
    dropKnives: { bind_key: "MOUSE4", selected: [515, 507], cfg_present: true, cs2_running: false },
    cosmetics: defaultCosmetics(),
    updates: {
      checked_at: now,
      release_version: "1.4.2.6-Preview.2",
      release_notes_url: "https://github.com/numakkiyu/Local-Arena/releases",
      panel: { current_version: APP_DISPLAY_VERSION, latest_version: "1.4.2.6-Preview.2", update_available: true, compatible: true, status: "idle", downloaded_bytes: 0, total_bytes: 12_000_000, error: null },
      plugin: { current_version: APP_DISPLAY_VERSION, latest_version: "1.4.2.6-Preview.2", update_available: true, compatible: true, status: "idle", downloaded_bytes: 0, total_bytes: 4_000_000, error: null },
      busy: false,
      error: null,
    },
    activeMatch: null,
    history: [sessionFromResult(result)],
    results: { [result.session_id]: result },
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as BrowserMockState | null;
    if (parsed?.schema === 1) return parsed;
  } catch {
    // Start with a fresh isolated demo if its local state is malformed.
  }
  return defaultState();
}

let state = loadState();

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function knifeState(): KnifeCustomizerState {
  return { plugin_present: true, config_present: true, cs2_running: false, config: clone(state.cosmetics) };
}

function runtimeSnapshot(): RuntimeSnapshot {
  return {
    directory: clone(state.directory),
    process: { running: false, pid: null, executable: null, path_accessible: true, matches_selected: false },
    files: clone(state.files),
    difficulty: clone(state.difficulty),
    mode: clone(state.mode),
    bot_items: clone(state.botItems),
    presets: clone(state.presets),
    drop_knives: clone(state.dropKnives),
    installation: clone(state.installation),
  };
}

const matchCatalog: MatchCatalog = {
  schema_version: 1,
  catalog_version: "browser-demo-v1",
  freeze_date: "2026-07-23",
  source: "Browser demo",
  maps: ["de_mirage", "de_inferno", "de_dust2", "de_nuke", "de_ancient", "de_anubis"].map((id) => ({
    id,
    display_name: id.replace("de_", "").toUpperCase(),
    workshop_name: id,
    thumbnail: "",
    required_vpk: `${id}.vpk`,
  })),
  teams: [
    { id: "browser-demo-five", name: "Browser Demo Five", badge: "", ranking: 1, players: ["Nova", "Rook", "Vega", "Kite", "Echo"] },
    { id: "local-arena", name: "Local Arena", badge: "", ranking: 4, players: ["Atlas", "Bolt", "Cipher", "Drift", "Flux"] },
    { id: "preview-lab", name: "Preview Lab", badge: "", ranking: 9, players: ["Aster", "Cobalt", "Delta", "Ember", "Frost"] },
  ],
  difficulties: ["low", "medium", "high"],
};

function installReport(): InstallCheckReport {
  return {
    schema_version: 1,
    generated_at_unix: Math.floor(Date.now() / 1000),
    target: BROWSER_DEMO_CSGO_PATH,
    overall: "pass",
    pass_count: 3,
    warn_count: 0,
    fail_count: 0,
    blocking_fail_count: 0,
    can_proceed: true,
    checks: [
      { code: "DEMO001", status: "pass", blocking: false, title: "Browser demo", evidence: "Isolated local state", cause: "", action: "" },
      { code: "DEMO002", status: "pass", blocking: false, title: "Configuration", evidence: "Writable mock store", cause: "", action: "" },
      { code: "DEMO003", status: "pass", blocking: false, title: "Game process", evidence: "No real process used", cause: "", action: "" },
    ],
  };
}

function createMatchRequest(input: PrepareMatchInput): MatchRequest {
  const selectedTeam = matchCatalog.teams.find((team) => team.id === input.opponent_team_id) ?? matchCatalog.teams[0];
  const sessionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const players = (names: string[], kind: "human" | "bot"): MatchPlayer[] => names.map((name, index) => ({
    id: `${kind}-${index}-${sessionId}`,
    name,
    kind,
    is_local_player: kind === "human" && index === 0,
  }));
  return {
    schema_version: 1,
    session_id: sessionId,
    created_at_unix: now,
    map_id: input.map_id,
    player_side: input.player_side === "t" ? "t" : "ct",
    difficulty: input.difficulty,
    opponent_kind: input.opponent_kind,
    opponent_team_id: input.opponent_team_id,
    opponent_name: input.opponent_kind === "random" ? "Random lineup" : selectedTeam.name,
    record_demo: input.record_demo,
    player_team: players(["Player", "Atlas", "Bolt", "Cipher", "Drift"], "human"),
    opponent_team: players(selectedTeam.players, "bot"),
    result_path: `C:\\CS2 Browser Demo\\matches\\${sessionId}.json`,
    demo_path: `C:\\CS2 Browser Demo\\demos\\${sessionId}.dem`,
  };
}

export async function browserMockInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  let result: unknown;
  switch (command) {
    case "get_config": result = clone(state.config); break;
    case "save_config": {
      state.config = clone(args.config as AppConfig);
      if (state.config.language) localStorage.setItem("cs2bi.language", state.config.language);
      persist();
      result = undefined;
      break;
    }
    case "get_panel_memory": result = clone(state.memory); break;
    case "save_panel_memory": {
      state.memory = { schema_version: 1, saved_at: Math.floor(Date.now() / 1000), entries: clone(args.entries as Record<string, string>) };
      persist();
      result = clone(state.memory);
      break;
    }
    case "record_panel_error": result = undefined; break;
    case "get_runtime_snapshot": result = runtimeSnapshot(); break;
    case "detect_directories": result = clone(state.directory); break;
    case "select_directory": {
      const path = String(args.path || BROWSER_DEMO_CSGO_PATH);
      state.directory = { candidates: [path], selected: path, valid: true, needs_choice: false, steam_found: true };
      state.config.csgo_path = path;
      persist();
      result = clone(state.directory);
      break;
    }
    case "cleanup_backups": result = 0; break;
    case "validate_files": result = clone(state.files); break;
    case "get_difficulty": result = clone(state.difficulty); break;
    case "set_difficulty": {
      state.difficulty.current = args.level as DifficultyLevel;
      state.config.difficulty = String(args.level);
      persist();
      result = clone(state.difficulty);
      break;
    }
    case "get_mode": result = clone(state.mode); break;
    case "set_mode": {
      state.mode.current = args.mode as GameMode;
      state.mode.insecure = args.mode !== "online";
      state.config.mode = String(args.mode);
      state.config.insecure = state.mode.insecure;
      persist();
      result = clone(state.mode);
      break;
    }
    case "reconcile_launch_options": result = 0; break;
    case "launch_cs2": result = { options: "-insecure -console", insecure: true }; break;
    case "reconcile_core_json": result = undefined; break;
    case "get_bot_items": result = clone(state.botItems); break;
    case "set_bot_item": {
      const item = args.item as BotItemKey;
      state.botItems[item] = Boolean(args.on);
      state.config.bot_items[item] = Boolean(args.on);
      persist();
      result = clone(state.botItems);
      break;
    }
    case "get_presets": result = clone(state.presets); break;
    case "set_aim": {
      state.presets.aim = args.value as PresetsState["aim"];
      state.config.aim = String(args.value);
      persist();
      result = clone(state.presets);
      break;
    }
    case "set_nades": {
      state.presets.nades = args.value as PresetsState["nades"];
      state.config.nades = String(args.value);
      persist();
      result = clone(state.presets);
      break;
    }
    case "get_drop_knives": result = clone(state.dropKnives); break;
    case "set_drop_knives": {
      state.dropKnives.bind_key = String(args.bindKey);
      state.dropKnives.selected = clone(args.selected as number[]);
      state.config.drop_knife_bind = state.dropKnives.bind_key;
      state.config.drop_knife_subclasses = clone(state.dropKnives.selected);
      persist();
      result = clone(state.dropKnives);
      break;
    }
    case "get_knife_customizer": result = knifeState(); break;
    case "save_knife_customizer": {
      state.cosmetics = clone(args.config as KnifeCustomizerConfig);
      persist();
      result = knifeState();
      break;
    }
    case "export_cosmetics_preset": result = { path: String(args.destination), size_bytes: JSON.stringify(state.cosmetics).length }; break;
    case "import_cosmetics_preset": result = { state: knifeState(), backup_path: "C:\\CS2 Browser Demo\\backups\\pre-import" } satisfies CosmeticsPresetImportResult; break;
    case "inspect_installation": result = clone(state.installation); break;
    case "get_install_plan": result = {
      package_version: APP_DISPLAY_VERSION, target: String(args.csgo), total_files: 42, new_files: 0, overwritten_files: 42,
      backup_path: "C:\\CS2 Browser Demo\\backups\\next", required_target_bytes: 8_000_000, available_target_bytes: 100_000_000_000,
      required_backup_bytes: 8_000_000, available_backup_bytes: 100_000_000_000, writable: true, source: state.installation.source,
      source_version: state.installation.source_version, source_evidence: ["Browser demo state"], migration_kind: "managed_upgrade",
      restore_baseline: "existing_record", can_install: true,
    }; break;
    case "install_payload":
    case "repair_payload": {
      state.installation.installed = true;
      state.installation.healthy = state.installation.total;
      state.installation.missing = [];
      state.installation.corrupt = [];
      persist();
      result = { package_version: APP_DISPLAY_VERSION, installed_files: 42, backup_path: state.installation.backup_path || "", repaired: command === "repair_payload" };
      break;
    }
    case "restore_payload":
    case "restore_pristine_cs2": {
      state.installation.installed = false;
      state.installation.package_version = null;
      persist();
      result = { restored_files: 42, removed_files: 42, preserved_files: 4, presets_backup: "C:\\CS2 Browser Demo\\backups\\presets", steam_verify_uri: "steam://validate/730", result_kind: command === "restore_payload" ? "restore_previous" : "pristine" };
      break;
    }
    case "export_diagnostics": result = { path: "C:\\CS2 Browser Demo\\diagnostics\\cs2bip-browser-demo.zip", files_collected: 8 }; break;
    case "get_update_snapshot": result = clone(state.updates); break;
    case "check_online_updates": {
      state.updates.checked_at = Math.floor(Date.now() / 1000);
      persist();
      result = clone(state.updates);
      break;
    }
    case "install_panel_update":
    case "install_plugin_update": {
      const component = command === "install_panel_update" ? "panel" : "plugin";
      const update = state.updates[component];
      update.current_version = update.latest_version || update.current_version;
      update.update_available = false;
      update.downloaded_bytes = update.total_bytes;
      update.status = "installed";
      persist();
      result = { component, version: update.current_version, installed: true, restart_required: component === "panel", rollback_succeeded: null, detail: "Browser demo update completed" };
      break;
    }
    case "cancel_update": state.updates.busy = false; persist(); result = undefined; break;
    case "get_match_catalog": result = clone(matchCatalog); break;
    case "prepare_and_launch_match": {
      const request = createMatchRequest(args.input as PrepareMatchInput);
      state.activeMatch = {
        schema_version: 1, session_id: request.session_id, state: "launching", map_id: request.map_id,
        opponent_name: request.opponent_name, created_at_unix: request.created_at_unix, player_score: 0, opponent_score: 0,
        demo: { state: request.record_demo ? "pending" : "disabled", path: request.record_demo ? request.demo_path : null, size_bytes: 0, error_code: null, detail: null },
        result_path: request.result_path,
      };
      persist();
      result = request;
      break;
    }
    case "finish_active_match": {
      const sessionId = String(args.sessionId);
      const active = state.activeMatch;
      const match = completedMatch(sessionId);
      if (active) {
        match.map_id = active.map_id;
        match.opponent_name = active.opponent_name;
      }
      state.results[sessionId] = match;
      const finished = sessionFromResult(match);
      state.history = [finished, ...state.history.filter((entry) => entry.session_id !== sessionId)];
      state.activeMatch = null;
      persist();
      queueMicrotask(() => dispatchBrowserEvent("match-finished", clone(match)));
      result = finished;
      break;
    }
    case "get_active_match": result = clone(state.activeMatch); break;
    case "list_match_history": result = clone(state.history); break;
    case "get_match_result": result = clone(state.results[String(args.sessionId)] || completedMatch(String(args.sessionId))); break;
    case "delete_match": {
      const sessionId = String(args.sessionId);
      state.history = state.history.filter((entry) => entry.session_id !== sessionId);
      delete state.results[sessionId];
      persist();
      result = undefined;
      break;
    }
    case "play_demo":
    case "open_demo_folder": result = undefined; break;
    case "run_install_checks": result = installReport(); break;
    default: throw new Error(`Browser demo does not implement command: ${command}`);
  }
  return clone(result) as T;
}
