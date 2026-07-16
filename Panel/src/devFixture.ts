import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

export function installDevFixture() {
  const csgo = "F:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\csgo";
  const config = {
    language: "schinese", difficulty: "Medium", mode: "preview", insecure: true,
    bot_items: { skins: true, profiles: true, agents: true, music: true },
    aim: "mixed", nades: "normal", drop_knife_bind: "\\", drop_knife_subclasses: [],
    csgo_path: csgo, first_run_done: true, first_run_step: "complete",
    cosmetics_enabled_before_online: null, cosmetics_enabled_before_preview: false,
  };
  const mode = {
    current: "preview", online_present: true, preview_present: true, bots_present: true,
    layout_healthy: true, insecure: true, user_count: 1, cs2_running: false, pending: false,
  };
  const installation = {
    installed: true, package_version: "1.4.2.3", manifest_available: true,
    total: 128, healthy: 128, missing: [], corrupt: [], restore_available: true,
    backup_path: "F:\\CS2BotImproverPlus\\.csbip\\installations\\abcdef",
    interrupted_transaction: false,
  };
  const runtime = {
    directory: { candidates: [csgo], selected: csgo, valid: true, needs_choice: false, steam_found: true },
    process: { running: false, pid: null, executable: null, path_accessible: false, matches_selected: false },
    files: { ok: true, total: 128, present: 128, missing: [], misplaced: null },
    difficulty: { current: "Medium", available: ["Low", "Medium", "High"], active_present: true, cs2_running: false },
    mode,
    bot_items: { skins: true, profiles: true, agents: true, music: true, cfg_present: true, cs2_running: false },
    presets: { aim: "mixed", nades: "normal", cfg_present: true, cs2_running: false },
    drop_knives: { bind_key: "\\", selected: [], cfg_present: true, cs2_running: false },
    installation,
  };
  const updates = {
    checked_at: 1784169000, release_version: "1.4.2.4",
    release_notes_url: "https://github.com/numakkiyu/CS2-Bot-Improver-Plus/releases/tag/v1.4.2.4",
    busy: false, error: null,
    panel: { current_version: "1.4.2.3", latest_version: "1.4.2.4", update_available: true,
      compatible: true, status: "available", downloaded_bytes: 7_340_032, total_bytes: 12_582_912, error: null },
    plugin: { current_version: "1.4.2.3", latest_version: "1.4.2.4", update_available: true,
      compatible: true, status: "available", downloaded_bytes: 0, total_bytes: 52_428_800, error: null },
  };

  mockWindows("main");
  mockIPC((command) => {
    if (command === "get_config") return config;
    if (command === "get_runtime_snapshot") return runtime;
    if (command === "get_panel_memory") return { schema_version: 1, saved_at: 0, entries: {} };
    if (command === "get_update_snapshot" || command === "check_online_updates") return updates;
    if (command === "set_mode") return mode;
    if (command === "save_config" || command === "save_panel_memory") return null;
    if (command.startsWith("plugin:window|") || command.startsWith("plugin:webview|")) return null;
    return null;
  }, { shouldMockEvents: true });
}
