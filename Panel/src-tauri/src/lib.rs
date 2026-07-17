use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

mod atomic_fs;
mod app_storage;
mod diagnostics;
mod installer;
mod logging;
mod mode_files;
mod mode_layout;
mod online_update;
mod runtime_state;
mod steam;
mod update_core;
use installer::{InstallPlan, InstallTransactionResult, InstallationInspection, RestoreResult};
use mode_files::{apply_launch_mode, contains_metamod_search_path, LaunchMode};
use runtime_state::{blocks_target_write, inspect_cs2_process, Cs2ProcessInfo};

type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, Serialize)]
struct AppError {
    code: &'static str,
    category: &'static str,
    detail: String,
}

impl AppError {
    fn new(code: &'static str, category: &'static str, detail: impl Into<String>) -> Self {
        Self { code, category, detail: detail.into() }
    }
    fn io(detail: impl Into<String>) -> Self {
        Self::new("E1001", "filesystem", detail)
    }
    fn invalid(detail: impl Into<String>) -> Self {
        Self::new("E1002", "validation", detail)
    }
    fn directory(detail: impl Into<String>) -> Self { Self::new("E1101", "directory", detail) }
    fn process(detail: impl Into<String>) -> Self { Self::new("E1201", "process", detail) }
    pub(crate) fn payload(detail: impl Into<String>) -> Self { Self::new("E1301", "payload", detail) }
    pub(crate) fn transaction(detail: impl Into<String>) -> Self { Self::new("E1401", "installation", detail) }
    pub(crate) fn transaction_io(error: std::io::Error) -> Self { Self::transaction(error.to_string()) }
    fn launch(detail: impl Into<String>) -> Self { Self::new("E1501", "launch", detail) }
    fn update(detail: impl Into<String>) -> Self { Self::new("E1601", "update", detail) }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self { Self::io(value.to_string()) }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self { Self::invalid(value.to_string()) }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct BotItems {
    skins: bool,
    profiles: bool,
    agents: bool,
    music: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AppConfig {
    language: Option<String>,
    difficulty: Option<String>,
    mode: Option<String>,
    insecure: bool,
    bot_items: BotItems,
    aim: Option<String>,
    nades: Option<String>,
    drop_knife_bind: String,
    drop_knife_subclasses: Vec<u16>,
    csgo_path: Option<String>,
    first_run_done: bool,
    #[serde(default)]
    first_run_step: Option<String>,
    #[serde(default)]
    cosmetics_enabled_before_online: Option<bool>,
    #[serde(default)]
    cosmetics_enabled_before_preview: Option<bool>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: Some("schinese".into()), difficulty: Some("Medium".into()),
            mode: Some("bots".into()), insecure: true, bot_items: BotItems::default(),
            aim: Some("mixed".into()), nades: Some("normal".into()),
            drop_knife_bind: "\\".into(), drop_knife_subclasses: vec![],
            csgo_path: None, first_run_done: false, first_run_step: Some("language".into()),
            cosmetics_enabled_before_online: None,
            cosmetics_enabled_before_preview: None,
        }
    }
}

#[derive(Serialize)]
struct DirectoryInfo { candidates: Vec<String>, selected: Option<String>, valid: bool, needs_choice: bool, steam_found: bool }
#[derive(Serialize)]
struct FilesReport { ok: bool, total: usize, present: usize, missing: Vec<String>, misplaced: Option<String> }
#[derive(Serialize)]
struct DifficultyInfo { current: Option<String>, available: Vec<String>, active_present: bool, cs2_running: bool }
#[derive(Serialize)]
struct ModeInfo {
    current: Option<String>,
    online_present: bool,
    preview_present: bool,
    bots_present: bool,
    layout_healthy: bool,
    insecure: bool,
    user_count: u32,
    cs2_running: bool,
    pending: bool,
}
#[derive(Serialize)]
struct LaunchResult { options: String, insecure: bool }
#[derive(Serialize)]
struct BotItemsState { skins: bool, profiles: bool, agents: bool, music: bool, cfg_present: bool, cs2_running: bool }
#[derive(Serialize)]
struct PresetsState { aim: Option<String>, nades: Option<String>, cfg_present: bool, cs2_running: bool }
#[derive(Serialize)]
struct DropKnivesState { bind_key: String, selected: Vec<u16>, cfg_present: bool, cs2_running: bool }

#[derive(Serialize)]
struct RuntimeSnapshot {
    directory: DirectoryInfo,
    process: Cs2ProcessInfo,
    files: Option<FilesReport>,
    difficulty: Option<DifficultyInfo>,
    mode: Option<ModeInfo>,
    bot_items: Option<BotItemsState>,
    presets: Option<PresetsState>,
    drop_knives: Option<DropKnivesState>,
    installation: Option<InstallationInspection>,
}

#[derive(Deserialize)]
struct PanelErrorRecord {
    code: String,
    category: String,
    detail: String,
    context: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct KnifePreset {
    paint: i32,
    seed: i32,
    wear: f32,
    name_tag: String,
    stattrak_enabled: bool,
    stattrak_count: i32,
    #[serde(default)]
    souvenir_enabled: bool,
}

const DEFAULT_GLOVE_DEFINDEX: u16 = 5030;
const DEFAULT_GLOVE_PAINT: i32 = 10048;
const DEFAULT_GLOVE_WEAR: f32 = 0.01;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct GlovePreset {
    enabled: bool,
    defindex: u16,
    paint: i32,
    seed: i32,
    wear: f32,
}

impl Default for GlovePreset {
    fn default() -> Self {
        Self {
            enabled: false,
            defindex: DEFAULT_GLOVE_DEFINDEX,
            paint: DEFAULT_GLOVE_PAINT,
            seed: 0,
            wear: DEFAULT_GLOVE_WEAR,
        }
    }
}

const COSMETICS_SCHEMA_VERSION: u8 = 2;
const CT_ONLY_WEAPONS: &[u16] = &[3, 8, 10, 16, 27, 32, 34, 38, 60, 61];
const T_ONLY_WEAPONS: &[u16] = &[4, 7, 11, 13, 17, 29, 30, 39];
const SHARED_WEAPONS: &[u16] = &[1, 2, 9, 14, 19, 23, 24, 25, 26, 28, 31, 33, 35, 36, 40, 63, 64];

#[derive(Clone, Copy, Debug, PartialEq)]
enum WeaponSide {
    Ct,
    T,
    Shared,
}

fn weapon_side(defindex: u16) -> WeaponSide {
    if CT_ONLY_WEAPONS.contains(&defindex) {
        WeaponSide::Ct
    } else if T_ONLY_WEAPONS.contains(&defindex) {
        WeaponSide::T
    } else {
        WeaponSide::Shared
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct TeamLoadout {
    #[serde(default)]
    default_knife_defindex: u16,
    #[serde(default)]
    knife_presets: BTreeMap<String, KnifePreset>,
    #[serde(default)]
    glove: GlovePreset,
    #[serde(default)]
    gun_presets: BTreeMap<String, KnifePreset>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct TeamLoadouts {
    #[serde(default)]
    ct: TeamLoadout,
    #[serde(default)]
    t: TeamLoadout,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct TeamGunConfig {
    #[serde(default)]
    schema_version: u8,
    #[serde(default)]
    ct: BTreeMap<String, KnifePreset>,
    #[serde(default)]
    t: BTreeMap<String, KnifePreset>,
    #[serde(default)]
    shared_weapon_links: BTreeMap<String, bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct KnifeCustomizerConfig {
    #[serde(default)]
    schema_version: u8,
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_true")]
    apply_to_human_players: bool,
    #[serde(default = "default_true")]
    apply_on_pickup: bool,
    #[serde(default)]
    music_kit_id: i32,
    #[serde(default)]
    loadouts: TeamLoadouts,
    #[serde(default)]
    shared_weapon_links: BTreeMap<String, bool>,

    // Read-only v1 fields. They are migrated in memory and never serialized again.
    #[serde(default, skip_serializing)]
    default_knife_defindex: u16,
    #[serde(default, skip_serializing)]
    presets: BTreeMap<String, KnifePreset>,
    #[serde(default, skip_serializing)]
    gun_presets: BTreeMap<String, KnifePreset>,
    #[serde(default, skip_serializing)]
    glove: GlovePreset,
}

fn default_true() -> bool { true }

impl Default for KnifeCustomizerConfig {
    fn default() -> Self {
        let mut shared_weapon_links = BTreeMap::new();
        for defindex in SHARED_WEAPONS {
            shared_weapon_links.insert(defindex.to_string(), true);
        }
        Self {
            schema_version: COSMETICS_SCHEMA_VERSION,
            enabled: false,
            apply_to_human_players: true,
            apply_on_pickup: true,
            music_kit_id: 0,
            loadouts: TeamLoadouts::default(),
            shared_weapon_links,
            default_knife_defindex: 0,
            presets: BTreeMap::new(),
            gun_presets: BTreeMap::new(),
            glove: GlovePreset::default(),
        }
    }
}

#[derive(Serialize)]
struct KnifeCustomizerState { plugin_present: bool, config_present: bool, cs2_running: bool, config: KnifeCustomizerConfig }

fn legacy_config_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| AppError::io(e.to_string()))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

fn config_path() -> Result<PathBuf> { app_storage::panel_config_path() }

fn read_config(app: &AppHandle) -> Result<AppConfig> {
    let path = config_path()?;
    if !path.is_file() {
        let legacy = legacy_config_path(app)?;
        if legacy.is_file() {
            let config: AppConfig = serde_json::from_str(&fs::read_to_string(&legacy)?)?;
            write_json_atomic(&path, &config)?;
            if let Ok(root) = app_storage::root() {
                logging::append(&root, "INFO", "config.migrated", &legacy.to_string_lossy());
            }
            return Ok(config);
        }
    }
    if !path.exists() { return Ok(AppConfig::default()); }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    atomic_fs::write_replace(path, &bytes).map_err(AppError::transaction_io)
}

fn write_config(_app: &AppHandle, config: &AppConfig) -> Result<()> { write_json_atomic(&config_path()?, config) }

fn cs2_running() -> bool {
    inspect_cs2_process(None).running
}

fn ensure_target_not_running(root: &Path) -> Result<()> {
    let process = inspect_cs2_process(Some(root));
    if blocks_target_write(&process) {
        let detail = match (&process.executable, process.path_accessible) {
            (Some(path), _) => format!("Close CS2 before modifying this installation (PID {}, {path})", process.pid.unwrap_or_default()),
            (_, false) => "A running cs2.exe could not be matched to an installation. Close CS2, then try again".to_string(),
            _ => "Close CS2 before modifying this installation".to_string(),
        };
        return Err(AppError::process(detail));
    }
    Ok(())
}

fn valid_csgo(path: &Path) -> bool { path.join("gameinfo.gi").is_file() && path.join("cfg").is_dir() }
fn csgo_path(raw: &str) -> Result<PathBuf> {
    let path = PathBuf::from(raw);
    if !valid_csgo(&path) { return Err(AppError::directory(format!("Not a CS2 game/csgo directory: {raw}"))); }
    Ok(path)
}

fn cfg_paths(csgo: &Path) -> [PathBuf; 2] {
    [csgo.join("cfg/my_bot_normal_config.cfg"), csgo.join("cfg/my_bot_ffa_config.cfg")]
}

fn replace_cfg_command(path: &Path, command: &str, replacement: &str) -> Result<()> {
    let text = fs::read_to_string(path)?;
    let mut found = false;
    let mut lines = Vec::new();
    for line in text.lines() {
        if line.trim_start().starts_with(command) {
            if !found { lines.push(replacement.to_string()); found = true; }
        } else { lines.push(line.to_string()); }
    }
    if !found { lines.push(replacement.to_string()); }
    fs::write(path, format!("{}\r\n", lines.join("\r\n")))?;
    Ok(())
}

#[tauri::command]
fn get_config(app: AppHandle) -> Result<AppConfig> { read_config(&app) }

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> Result<()> { write_config(&app, &config) }

#[tauri::command]
fn detect_directories(app: AppHandle) -> Result<DirectoryInfo> {
    let mut config = read_config(&app)?;
    let mut candidates = Vec::new();
    if let Some(path) = &config.csgo_path { if valid_csgo(Path::new(path)) { candidates.push(path.clone()); } }
    for path in steam::detect_cs2_directories() {
        let path = path.to_string_lossy().into_owned();
        if !candidates.iter().any(|candidate| steam::paths_equal(Path::new(candidate), Path::new(&path))) {
            candidates.push(path);
        }
    }
    let saved = config.csgo_path.clone().filter(|p| valid_csgo(Path::new(p)));
    let selected = saved.or_else(|| (candidates.len() == 1).then(|| candidates[0].clone()));
    if selected.is_some() && config.csgo_path != selected {
        config.csgo_path = selected.clone();
        write_config(&app, &config)?;
    }
    Ok(DirectoryInfo { valid: selected.is_some(), needs_choice: candidates.len() > 1 && selected.is_none(), steam_found: !candidates.is_empty(), candidates, selected })
}

#[tauri::command]
fn select_directory(app: AppHandle, path: String) -> Result<DirectoryInfo> {
    csgo_path(&path)?;
    let mut config = read_config(&app)?;
    config.csgo_path = Some(path);
    write_config(&app, &config)?;
    detect_directories(app)
}

fn payload_root() -> Result<PathBuf> {
    if let Some(payload) = online_update::active_payload_root() { return Ok(payload); }
    let executable = std::env::current_exe().map_err(|error| AppError::payload(error.to_string()))?;
    executable.parent().map(Path::to_path_buf)
        .ok_or_else(|| AppError::payload("Panel executable has no parent directory"))
}

fn local_state_root(_app: &AppHandle) -> Result<PathBuf> { app_storage::root() }

#[tauri::command]
fn get_panel_memory() -> Result<app_storage::UiMemory> { app_storage::read_ui_memory() }

#[tauri::command]
fn save_panel_memory(entries: BTreeMap<String, String>) -> Result<app_storage::UiMemory> {
    app_storage::write_ui_memory(entries)
}

#[tauri::command]
fn record_panel_error(error: PanelErrorRecord) -> Result<()> {
    let root = app_storage::root()?;
    let detail = format!("{} [{}] {} | {}", error.code, error.category, error.detail,
        error.context.unwrap_or_else(|| "no-context".to_string()));
    logging::append(&root, "ERROR", "panel.error", &detail);
    Ok(())
}

#[tauri::command]
fn cleanup_backups(_csgo: String) -> u32 { 0 }

fn validate_files_at(app: Option<&AppHandle>, root: &Path, verify_hashes: bool) -> Result<FilesReport> {
    if let Some(app) = app {
        if let (Ok(payload), Ok(state)) = (payload_root(), local_state_root(app)) {
            let inspection = if verify_hashes { installer::inspect(&payload, &state, root) }
                else { installer::inspect_quick(&payload, &state, root) };
            if let Ok(inspection) = inspection {
                if inspection.total > 0 {
                    let mut missing = inspection.missing;
                    missing.extend(inspection.corrupt.into_iter().map(|path| format!("{path} (hash mismatch)")));
                    return Ok(FilesReport { ok: missing.is_empty(), total: inspection.total,
                        present: inspection.healthy, missing, misplaced: None });
                }
            }
        }
    }
    let required = ["gameinfo.gi", "cfg/my_bot_normal_config.cfg", "cfg/my_bot_ffa_config.cfg",
        "addons/counterstrikesharp/plugins/BotAI/BotAI.dll", "addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.dll",
        "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/PlayerKnifeCustomizer.dll",
        "addons/MetaMod/bin/win64/server.dll", "addons/counterstrikesharp/bin/win64/counterstrikesharp.dll"];
    let missing: Vec<String> = required.iter().filter(|p| {
        let canonical = root.join(p);
        !canonical.is_file() && !mode_layout::disabled_path(&canonical).is_file()
    }).map(|p| p.to_string()).collect();
    Ok(FilesReport { ok: missing.is_empty(), total: required.len(), present: required.len() - missing.len(), missing, misplaced: None })
}

#[tauri::command]
fn validate_files(app: AppHandle, csgo: String) -> Result<FilesReport> {
    let root = csgo_path(&csgo)?;
    validate_files_at(Some(&app), &root, true)
}

fn same_file(a: &Path, b: &Path) -> bool { fs::read(a).ok().zip(fs::read(b).ok()).is_some_and(|(a,b)| a == b) }

fn difficulty_at(root: &Path, running: bool) -> DifficultyInfo {
    let active = root.join("overrides/botprofile.vpk");
    let selected = mode_layout::active_or_disabled(&active);
    let current = ["Low", "Medium", "High"].iter()
        .find(|name| selected.as_deref().is_some_and(|path|
            same_file(path, &root.join(format!("overrides/{name}/botprofile.vpk")))))
        .map(|name| name.to_string());
    DifficultyInfo { current, available: vec!["Low".into(), "Medium".into(), "High".into()],
        active_present: selected.is_some(), cs2_running: running }
}

fn set_difficulty_at(root: &Path, state: &Path, level: &str, running: bool) -> Result<DifficultyInfo> {
    if !["Low", "Medium", "High"].contains(&level) {
        return Err(AppError::invalid("Unknown difficulty"));
    }
    let source = root.join(format!("overrides/{level}/botprofile.vpk"));
    let bytes = fs::read(&source).map_err(|error| AppError::payload(format!(
        "The {level} difficulty profile is missing or unreadable ({}): {error}", source.display())))?;
    mode_layout::write_managed_file(
        root,
        "overrides/botprofile.vpk",
        &bytes,
        mode_layout::is_preview(state, root),
    )?;
    Ok(difficulty_at(root, running))
}

#[tauri::command]
fn get_difficulty(csgo: String) -> Result<DifficultyInfo> {
    let root = csgo_path(&csgo)?;
    Ok(difficulty_at(&root, inspect_cs2_process(Some(&root)).running))
}

#[tauri::command]
fn set_difficulty(app: AppHandle, csgo: String, level: String) -> Result<DifficultyInfo> {
    let root = csgo_path(&csgo)?;
    let running = inspect_cs2_process(Some(&root)).running;
    set_difficulty_at(&root, &local_state_root(&app)?, &level, running)
}

#[tauri::command]
fn get_mode(app: AppHandle, csgo: String) -> Result<ModeInfo> {
    let root = csgo_path(&csgo)?;
    let config = read_config(&app)?;
    Ok(mode_at(&root, &config, inspect_cs2_process(Some(&root)).running))
}

fn mode_at(root: &Path, config: &AppConfig, running: bool) -> ModeInfo {
    let gameinfo = root.join("gameinfo.gi");
    let online_present = root.join("backup/Online/gameinfo.gi").is_file();
    let bots_present = root.join("backup/WithBots/gameinfo.gi").is_file();
    let preview_present = root.join("addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/PlayerKnifeCustomizer.dll").is_file();
    let state = app_storage::root().ok();
    let current = fs::read(&gameinfo).ok().map(|bytes| {
        if !contains_metamod_search_path(&bytes) {
            "online".into()
        } else if state.as_deref().is_some_and(|state| mode_layout::is_preview(state, root)) {
            "preview".into()
        } else {
            "bots".into()
        }
    });
    let expects_preview = current.as_deref() == Some("preview");
    let layout_healthy = mode_layout::layout_healthy(root, expects_preview);
    ModeInfo { pending: current.as_deref() != config.mode.as_deref() || !layout_healthy, current,
        online_present, preview_present, bots_present, layout_healthy, insecure: config.insecure,
        user_count: 1, cs2_running: running }
}

#[tauri::command]
fn set_mode(app: AppHandle, csgo: String, mode: String) -> Result<ModeInfo> {
    let root = csgo_path(&csgo)?;
    ensure_target_not_running(&root)?;
    let launch_mode = LaunchMode::parse(Some(&mode)).map_err(AppError::invalid)?;
    let state = local_state_root(&app)?;
    mode_layout::recover(&state, &root)?;
    apply_launch_mode(&root, launch_mode).map_err(AppError::invalid)?;
    mode_layout::set_preview(&state, &root, launch_mode == LaunchMode::Preview)?;
    let mut config = read_config(&app)?;
    enforce_mode_cosmetics(&root, &mut config, launch_mode)?;
    config.mode = Some(mode.clone()); config.insecure = launch_mode.insecure();
    write_config(&app, &config)?;
    get_mode(app, csgo)
}

#[tauri::command]
fn reconcile_launch_options() -> u32 { 0 }

fn find_steam_executable() -> Result<PathBuf> {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    if let Some(path) = system.processes().values()
        .find(|process| process.name().eq_ignore_ascii_case("steam.exe"))
        .and_then(|process| process.exe())
        .filter(|path| path.is_file())
    {
        return Ok(path.to_path_buf());
    }

    let mut candidates = Vec::new();
    for variable in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(root) = std::env::var_os(variable) {
            candidates.push(PathBuf::from(root).join("Steam/Steam.exe"));
        }
    }
    candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam\Steam.exe"));

    candidates.into_iter().find(|path| path.is_file())
        .ok_or_else(|| AppError::launch("Steam.exe was not found. Start Steam, then try again"))
}

fn launch_request(mode: LaunchMode) -> (Vec<&'static str>, String) {
    if mode.insecure() {
        (
            vec!["-applaunch", "730", "-insecure", "-console", "-condebug"],
            "-insecure -console -condebug".into(),
        )
    } else {
        (vec!["-applaunch", "730"], String::new())
    }
}

#[tauri::command]
fn launch_cs2(app: AppHandle) -> Result<LaunchResult> {
    let mut config = read_config(&app)?;
    let mode = LaunchMode::parse(config.mode.as_deref()).map_err(AppError::invalid)?;
    let configured_path = config.csgo_path.as_deref()
        .ok_or_else(|| AppError::directory("Select the CS2 game/csgo directory before launching"))?;
    let root = csgo_path(configured_path)?;
    ensure_target_not_running(&root)?;
    let state = local_state_root(&app)?;
    mode_layout::recover(&state, &root)?;
    apply_launch_mode(&root, mode).map_err(AppError::invalid)?;
    mode_layout::set_preview(&state, &root, mode == LaunchMode::Preview)?;
    enforce_mode_cosmetics(&root, &mut config, mode)?;

    config.insecure = mode.insecure();
    write_config(&app, &config)?;
    let steam = find_steam_executable()?;
    let (arguments, options) = launch_request(mode);
    Command::new(steam).args(arguments).spawn()?;
    Ok(LaunchResult { options, insecure: mode.insecure() })
}

#[tauri::command]
fn reconcile_core_json(_csgo: String) -> Result<()> { Ok(()) }

#[tauri::command]
fn get_bot_items(app: AppHandle, csgo: String) -> Result<BotItemsState> {
    let root = csgo_path(&csgo)?;
    let config = read_config(&app)?;
    Ok(bot_items_at(&root, &config, inspect_cs2_process(Some(&root)).running))
}

fn bot_items_at(root: &Path, config: &AppConfig, running: bool) -> BotItemsState {
    let b = &config.bot_items;
    BotItemsState { skins: b.skins, profiles: b.profiles, agents: b.agents, music: b.music,
        cfg_present: root.join("addons/counterstrikesharp/configs/core.json").is_file(), cs2_running: running }
}

#[tauri::command]
fn set_bot_item(app: AppHandle, csgo: String, item: String, on: bool) -> Result<BotItemsState> {
    let mut config = read_config(&app)?;
    match item.as_str() { "skins" => config.bot_items.skins = on, "profiles" => config.bot_items.profiles = on,
        "agents" => config.bot_items.agents = on, "music" => config.bot_items.music = on,
        _ => return Err(AppError::invalid("Unknown bot item")) }
    write_config(&app, &config)?;
    get_bot_items(app, csgo)
}

#[tauri::command]
fn get_presets(app: AppHandle, csgo: String) -> Result<PresetsState> {
    let root = csgo_path(&csgo)?;
    let config = read_config(&app)?;
    Ok(presets_at(&root, &config, inspect_cs2_process(Some(&root)).running))
}

fn presets_at(root: &Path, config: &AppConfig, running: bool) -> PresetsState {
    PresetsState { aim: config.aim.clone(), nades: config.nades.clone(),
        cfg_present: cfg_paths(root).iter().all(|path| path.is_file()), cs2_running: running }
}

#[tauri::command]
fn set_aim(app: AppHandle, csgo: String, value: String) -> Result<PresetsState> {
    if !["head", "mixed", "body"].contains(&value.as_str()) { return Err(AppError::invalid("Unknown aim mode")); }
    let root = csgo_path(&csgo)?;
    for path in cfg_paths(&root) { replace_cfg_command(&path, "bot_aim", &format!("bot_aim {value}"))?; }
    let mut config = read_config(&app)?; config.aim = Some(value); write_config(&app, &config)?;
    get_presets(app, csgo)
}

#[tauri::command]
fn set_nades(app: AppHandle, csgo: String, value: String) -> Result<PresetsState> {
    if !["max", "more", "normal", "off"].contains(&value.as_str()) { return Err(AppError::invalid("Unknown nade mode")); }
    let root = csgo_path(&csgo)?;
    for path in cfg_paths(&root) { replace_cfg_command(&path, "bot_nades", &format!("bot_nades {value}"))?; }
    let mut config = read_config(&app)?; config.nades = Some(value); write_config(&app, &config)?;
    get_presets(app, csgo)
}

#[tauri::command]
fn get_drop_knives(app: AppHandle, csgo: String) -> Result<DropKnivesState> {
    let root = csgo_path(&csgo)?;
    let config = read_config(&app)?;
    Ok(drop_knives_at(&root, &config, inspect_cs2_process(Some(&root)).running))
}

fn drop_knives_at(root: &Path, config: &AppConfig, running: bool) -> DropKnivesState {
    DropKnivesState { bind_key: config.drop_knife_bind.clone(), selected: config.drop_knife_subclasses.clone(),
        cfg_present: cfg_paths(root).iter().all(|path| path.is_file()), cs2_running: running }
}

#[tauri::command]
fn set_drop_knives(app: AppHandle, csgo: String, bind_key: String, selected: Vec<u16>) -> Result<DropKnivesState> {
    let root = csgo_path(&csgo)?;
    let commands = selected.iter().map(|id| format!("subclass_create {id}")).collect::<Vec<_>>().join(";");
    let line = format!("bind {bind_key} \"{commands}\"");
    for path in cfg_paths(&root) { replace_cfg_command(&path, "bind ", &line)?; }
    let mut config = read_config(&app)?; config.drop_knife_bind = bind_key; config.drop_knife_subclasses = selected; write_config(&app, &config)?;
    get_drop_knives(app, csgo)
}

fn knife_config_path(root: &Path) -> PathBuf {
    root.join("addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/player_knife_presets.json")
}

fn gun_config_path(root: &Path) -> PathBuf {
    root.join("addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/player_gun_presets.json")
}

fn normalize_preset(preset: &mut KnifePreset) {
    preset.seed = preset.seed.clamp(0, 1000);
    preset.wear = preset.wear.clamp(0.0, 1.0);
    preset.stattrak_count = preset.stattrak_count.max(0);
    preset.name_tag = preset.name_tag.chars().take(20).collect();
    if preset.souvenir_enabled { preset.stattrak_enabled = false; }
}

fn normalize_team_loadout(team: WeaponSide, loadout: &mut TeamLoadout) -> Result<()> {
    for (def, preset) in &mut loadout.knife_presets {
        let defindex: u16 = def.parse().map_err(|_| AppError::invalid("Invalid knife defindex"))?;
        if !(500..=526).contains(&defindex) || preset.paint <= 0 {
            return Err(AppError::invalid("Invalid knife preset"));
        }
        normalize_preset(preset);
    }
    for (def, preset) in &mut loadout.gun_presets {
        let defindex: u16 = def.parse().map_err(|_| AppError::invalid("Invalid gun defindex"))?;
        if defindex == 0 || defindex >= 500 || preset.paint <= 0 {
            return Err(AppError::invalid("Invalid gun preset"));
        }
        if (team == WeaponSide::Ct && weapon_side(defindex) == WeaponSide::T)
            || (team == WeaponSide::T && weapon_side(defindex) == WeaponSide::Ct)
        {
            return Err(AppError::invalid("Weapon preset is stored under the wrong team"));
        }
        normalize_preset(preset);
    }
    if loadout.default_knife_defindex != 0
        && !loadout.knife_presets.contains_key(&loadout.default_knife_defindex.to_string())
    {
        return Err(AppError::invalid("Default knife has no saved preset"));
    }
    loadout.glove.seed = loadout.glove.seed.clamp(0, 1000);
    loadout.glove.wear = loadout.glove.wear.clamp(0.0, 1.0);
    if loadout.glove.enabled && loadout.glove.defindex == 0 && loadout.glove.paint == 0 {
        loadout.glove = GlovePreset { enabled: true, ..GlovePreset::default() };
    }
    if loadout.glove.enabled
        && (!(4725..=5035).contains(&loadout.glove.defindex) || loadout.glove.paint <= 0)
    {
        return Err(AppError::invalid("Invalid glove preset"));
    }
    Ok(())
}

fn ensure_shared_link_defaults(config: &mut KnifeCustomizerConfig) {
    for defindex in SHARED_WEAPONS {
        config.shared_weapon_links.entry(defindex.to_string()).or_insert(true);
    }
}

fn apply_legacy_guns(config: &mut KnifeCustomizerConfig, guns: BTreeMap<String, KnifePreset>) {
    config.loadouts.ct.gun_presets.clear();
    config.loadouts.t.gun_presets.clear();
    for (key, preset) in guns {
        let Ok(defindex) = key.parse::<u16>() else { continue };
        match weapon_side(defindex) {
            WeaponSide::Ct => { config.loadouts.ct.gun_presets.insert(key, preset); }
            WeaponSide::T => { config.loadouts.t.gun_presets.insert(key, preset); }
            WeaponSide::Shared => {
                config.loadouts.ct.gun_presets.insert(key.clone(), preset.clone());
                config.loadouts.t.gun_presets.insert(key.clone(), preset);
                config.shared_weapon_links.insert(key, true);
            }
        }
    }
}

fn migrate_legacy_config(config: &mut KnifeCustomizerConfig) {
    if config.schema_version >= COSMETICS_SCHEMA_VERSION {
        ensure_shared_link_defaults(config);
        return;
    }
    let legacy_guns = std::mem::take(&mut config.gun_presets);
    let legacy_loadout = TeamLoadout {
        default_knife_defindex: config.default_knife_defindex,
        knife_presets: std::mem::take(&mut config.presets),
        glove: std::mem::take(&mut config.glove),
        gun_presets: BTreeMap::new(),
    };
    config.loadouts.ct = legacy_loadout.clone();
    config.loadouts.t = legacy_loadout;
    config.schema_version = COSMETICS_SCHEMA_VERSION;
    apply_legacy_guns(config, legacy_guns);
    ensure_shared_link_defaults(config);
}

fn read_knife_config(root: &Path) -> Result<KnifeCustomizerConfig> {
    let path = knife_config_path(root);
    let mut config = if path.is_file() {
        serde_json::from_str(&fs::read_to_string(&path)?)?
    } else {
        KnifeCustomizerConfig::default()
    };
    migrate_legacy_config(&mut config);

    let gun_path = gun_config_path(root);
    if gun_path.is_file() {
        let text = fs::read_to_string(&gun_path)?;
        let value: serde_json::Value = serde_json::from_str(&text)?;
        if value.get("schema_version").and_then(serde_json::Value::as_u64)
            == Some(COSMETICS_SCHEMA_VERSION as u64)
        {
            let guns: TeamGunConfig = serde_json::from_value(value)?;
            config.loadouts.ct.gun_presets = guns.ct;
            config.loadouts.t.gun_presets = guns.t;
            config.shared_weapon_links = guns.shared_weapon_links;
        } else {
            apply_legacy_guns(&mut config, serde_json::from_value(value)?);
        }
    }
    ensure_shared_link_defaults(&mut config);
    Ok(config)
}

fn normalize_knife_config(config: &mut KnifeCustomizerConfig) -> Result<()> {
    migrate_legacy_config(config);
    config.schema_version = COSMETICS_SCHEMA_VERSION;
    config.music_kit_id = config.music_kit_id.clamp(0, u16::MAX as i32);
    normalize_team_loadout(WeaponSide::Ct, &mut config.loadouts.ct)?;
    normalize_team_loadout(WeaponSide::T, &mut config.loadouts.t)?;
    ensure_shared_link_defaults(config);

    for (key, linked) in &config.shared_weapon_links {
        let defindex: u16 = key.parse().map_err(|_| AppError::invalid("Invalid shared weapon defindex"))?;
        if defindex == 0 || defindex >= 500 || weapon_side(defindex) != WeaponSide::Shared {
            return Err(AppError::invalid("Invalid shared weapon link"));
        }
        if !linked { continue; }
        let ct = config.loadouts.ct.gun_presets.get(key);
        let t = config.loadouts.t.gun_presets.get(key);
        match (ct, t) {
            (Some(left), Some(right)) if left != right => {
                return Err(AppError::invalid("Linked CT/T weapon presets must match"));
            }
            (Some(preset), None) => {
                config.loadouts.t.gun_presets.insert(key.clone(), preset.clone());
            }
            (None, Some(preset)) => {
                config.loadouts.ct.gun_presets.insert(key.clone(), preset.clone());
            }
            _ => {}
        }
    }
    Ok(())
}

fn legacy_backup_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.v1.bak", path.to_string_lossy()))
}

fn backup_legacy_file(path: &Path) -> Result<()> {
    if !path.is_file() { return Ok(()); }
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    if value.get("schema_version").and_then(serde_json::Value::as_u64)
        == Some(COSMETICS_SCHEMA_VERSION as u64)
    {
        return Ok(());
    }
    let backup = legacy_backup_path(path);
    if !backup.exists() { fs::copy(path, backup)?; }
    Ok(())
}

fn save_knife_config(root: &Path, config: &mut KnifeCustomizerConfig) -> Result<()> {
    normalize_knife_config(config)?;
    let knife_path = knife_config_path(root);
    let gun_path = gun_config_path(root);
    backup_legacy_file(&knife_path)?;
    backup_legacy_file(&gun_path)?;
    write_json_atomic(&knife_path, config)?;
    let guns = TeamGunConfig {
        schema_version: COSMETICS_SCHEMA_VERSION,
        ct: config.loadouts.ct.gun_presets.clone(),
        t: config.loadouts.t.gun_presets.clone(),
        shared_weapon_links: config.shared_weapon_links.clone(),
    };
    write_json_atomic(&gun_path, &guns)
}

fn set_knife_customizer_enabled(root: &Path, enabled: bool) -> Result<Option<bool>> {
    let path = knife_config_path(root);
    if path.is_file() {
        let mut config = read_knife_config(root)?;
        let previous = config.enabled;
        if previous != enabled {
            config.enabled = enabled;
            save_knife_config(root, &mut config)?;
        }
        return Ok(Some(previous));
    }
    Ok(None)
}

fn enter_online_safety(root: &Path, app_config: &mut AppConfig) -> Result<()> {
    let previous = set_knife_customizer_enabled(root, false)?;
    if app_config.cosmetics_enabled_before_online.is_none() {
        app_config.cosmetics_enabled_before_online = previous;
    }
    Ok(())
}

fn leave_online_safety(root: &Path, app_config: &mut AppConfig) -> Result<()> {
    if let Some(previous) = app_config.cosmetics_enabled_before_online.take() {
        set_knife_customizer_enabled(root, previous)?;
    }
    Ok(())
}

fn enter_preview_safety(root: &Path, app_config: &mut AppConfig) -> Result<()> {
    let previous = set_knife_customizer_enabled(root, true)?;
    if app_config.cosmetics_enabled_before_preview.is_none() {
        app_config.cosmetics_enabled_before_preview = previous;
    }
    Ok(())
}

fn leave_preview_safety(root: &Path, app_config: &mut AppConfig) -> Result<()> {
    if let Some(previous) = app_config.cosmetics_enabled_before_preview.take() {
        set_knife_customizer_enabled(root, previous)?;
    }
    Ok(())
}

fn enforce_mode_cosmetics(root: &Path, app_config: &mut AppConfig, mode: LaunchMode) -> Result<()> {
    match mode {
        LaunchMode::Online => {
            leave_preview_safety(root, app_config)?;
            enter_online_safety(root, app_config)
        }
        LaunchMode::Preview => {
            leave_online_safety(root, app_config)?;
            enter_preview_safety(root, app_config)
        }
        LaunchMode::Bots => {
            leave_online_safety(root, app_config)?;
            leave_preview_safety(root, app_config)
        }
    }
}

#[tauri::command]
fn get_knife_customizer(csgo: String) -> Result<KnifeCustomizerState> {
    let root = csgo_path(&csgo)?;
    let path = knife_config_path(&root);
    let present = path.is_file();
    let config = read_knife_config(&root)?;
    if present { app_storage::mirror_cosmetics(&root)?; }
    Ok(KnifeCustomizerState { plugin_present: path.with_file_name("PlayerKnifeCustomizer.dll").is_file(), config_present: present, cs2_running: cs2_running(), config })
}

#[tauri::command]
fn save_knife_customizer(csgo: String, mut config: KnifeCustomizerConfig) -> Result<KnifeCustomizerState> {
    let root = csgo_path(&csgo)?;
    save_knife_config(&root, &mut config)?;
    app_storage::mirror_cosmetics(&root)?;
    get_knife_customizer(csgo)
}

#[tauri::command]
fn get_runtime_snapshot(app: AppHandle) -> Result<RuntimeSnapshot> {
    let directory = detect_directories(app.clone())?;
    let config = read_config(&app)?;
    let Some(selected) = directory.selected.clone() else {
        return Ok(RuntimeSnapshot {
            directory,
            process: inspect_cs2_process(None),
            files: None,
            difficulty: None,
            mode: None,
            bot_items: None,
            presets: None,
            drop_knives: None,
            installation: None,
        });
    };

    let root = csgo_path(&selected)?;
    let process = inspect_cs2_process(Some(&root));
    let running = process.running;
    let payload = payload_root().ok();
    let state = local_state_root(&app).ok();
    if let Some(state) = &state {
        let _ = installer::recover_incomplete(state, &root);
        if !running { let _ = mode_layout::recover(state, &root); }
    }
    let installation = payload.as_deref().zip(state.as_deref())
        .and_then(|(payload, state)| installer::inspect_quick(payload, state, &root).ok());

    Ok(RuntimeSnapshot {
        files: Some(validate_files_at(Some(&app), &root, false)?),
        difficulty: Some(difficulty_at(&root, running)),
        mode: Some(mode_at(&root, &config, running)),
        bot_items: Some(bot_items_at(&root, &config, running)),
        presets: Some(presets_at(&root, &config, running)),
        drop_knives: Some(drop_knives_at(&root, &config, running)),
        directory,
        process,
        installation,
    })
}

#[tauri::command]
fn inspect_installation(app: AppHandle, csgo: String) -> Result<InstallationInspection> {
    let root = csgo_path(&csgo)?;
    installer::recover_incomplete(&local_state_root(&app)?, &root)?;
    installer::inspect(&payload_root()?, &local_state_root(&app)?, &root)
}

#[tauri::command]
async fn get_install_plan(app: AppHandle, csgo: String) -> Result<InstallPlan> {
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = online_update::OperationGuard::acquire()?;
        let root = csgo_path(&csgo)?;
        ensure_target_not_running(&root)?;
        installer::plan(&payload_root()?, &local_state_root(&app)?, &root)
    }).await.map_err(|error| AppError::new("E1003", "internal", format!("Install preflight task failed: {error}")))?
}

#[tauri::command]
fn install_payload(app: AppHandle, csgo: String) -> Result<InstallTransactionResult> {
    let _busy = online_update::OperationGuard::acquire()?;
    let root = csgo_path(&csgo)?;
    ensure_target_not_running(&root)?;
    let state = local_state_root(&app)?;
    logging::append(&state, "INFO", "install.started", &root.to_string_lossy());
    let result = with_canonical_layout(&state, &root, || installer::install(&payload_root()?, &state, &root, false));
    match &result {
        Ok(value) => logging::append(&state, "INFO", "install.completed", &format!("{} files", value.installed_files)),
        Err(error) => logging::append(&state, "ERROR", "install.failed", &error.detail),
    }
    result
}

#[tauri::command]
fn repair_payload(app: AppHandle, csgo: String) -> Result<InstallTransactionResult> {
    let _busy = online_update::OperationGuard::acquire()?;
    let root = csgo_path(&csgo)?;
    ensure_target_not_running(&root)?;
    let state = local_state_root(&app)?;
    logging::append(&state, "INFO", "repair.started", &root.to_string_lossy());
    let result = with_canonical_layout(&state, &root, || installer::install(&payload_root()?, &state, &root, true));
    match &result {
        Ok(value) => logging::append(&state, "INFO", "repair.completed", &format!("{} files", value.installed_files)),
        Err(error) => logging::append(&state, "ERROR", "repair.failed", &error.detail),
    }
    result
}

#[tauri::command]
fn restore_payload(app: AppHandle, csgo: String) -> Result<RestoreResult> {
    let _busy = online_update::OperationGuard::acquire()?;
    let root = csgo_path(&csgo)?;
    ensure_target_not_running(&root)?;
    let state = local_state_root(&app)?;
    mode_layout::recover(&state, &root)?;
    mode_layout::set_preview(&state, &root, false)?;
    let mut config = read_config(&app)?;
    apply_launch_mode(&root, LaunchMode::Online).map_err(AppError::launch)?;
    enforce_mode_cosmetics(&root, &mut config, LaunchMode::Online)?;
    config.mode = Some("online".into());
    config.insecure = false;
    write_config(&app, &config)?;
    logging::append(&state, "INFO", "restore.started", &root.to_string_lossy());
    let result = installer::restore(&payload_root()?, &state, &root);
    match &result {
        Ok(value) => logging::append(&state, "INFO", "restore.completed", &format!("restored={}, removed={}, preserved={}", value.restored_files, value.removed_files, value.preserved_files)),
        Err(error) => logging::append(&state, "ERROR", "restore.failed", &error.detail),
    }
    result
}

fn installed_plugin_version(app: &AppHandle) -> Option<String> {
    let config = read_config(app).ok()?;
    let root = csgo_path(config.csgo_path.as_deref()?).ok()?;
    installer::inspect_quick(&payload_root().ok()?, &local_state_root(app).ok()?, &root).ok()?.package_version
}

#[tauri::command]
fn get_update_snapshot(app: AppHandle) -> Result<online_update::OnlineUpdateSnapshot> {
    online_update::snapshot(installed_plugin_version(&app).as_deref())
}

#[tauri::command]
async fn check_online_updates(app: AppHandle, force: bool) -> Result<online_update::OnlineUpdateSnapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        let plugin_version = installed_plugin_version(&app);
        let result = online_update::check(force, plugin_version.as_deref());
        if let Err(error) = &result { online_update::record_check_error(error); }
        result
    }).await.map_err(|error| AppError::update(format!("Update check task failed: {error}")))?
}

#[tauri::command]
async fn install_plugin_update(app: AppHandle, csgo: String) -> Result<online_update::UpdateResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = online_update::OperationGuard::acquire()?;
        let root = csgo_path(&csgo)?;
        ensure_target_not_running(&root)?;
        let state = local_state_root(&app)?;
        logging::append(&state, "INFO", "update.plugin_started", "host=github.com");
        let (version, payload) = online_update::prepare_plugin(&app)?;
        online_update::activate_payload(&version, &payload)?;
        match with_canonical_layout(&state, &root, || installer::install(&payload, &state, &root, false)) {
            Ok(value) => {
                logging::append(&state, "INFO", "update.plugin_completed", &format!("version={version}, files={}", value.installed_files));
                Ok(online_update::UpdateResult { component: "plugin".into(), version, installed: true,
                    restart_required: false, rollback_succeeded: None,
                    detail: format!("Plugin update installed ({} files)", value.installed_files) })
            }
            Err(error) => {
                logging::append(&state, "ERROR", "update.plugin_failed", &format!("stage=install, rollback=attempted, {}", error.detail));
                Err(error)
            }
        }
    }).await.map_err(|error| AppError::update(format!("Plugin update task failed: {error}")))?
}

#[tauri::command]
async fn install_panel_update(app: AppHandle) -> Result<online_update::UpdateResult> {
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || online_update::prepare_panel(&worker_app))
        .await.map_err(|error| AppError::update(format!("Panel update task failed: {error}")))??;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        app.exit(0);
    });
    Ok(result)
}

#[tauri::command]
fn cancel_update() { online_update::cancel(); }

fn with_canonical_layout<T>(state: &Path, root: &Path, operation: impl FnOnce() -> Result<T>) -> Result<T> {
    mode_layout::recover(state, root)?;
    let restore_preview = mode_layout::is_preview(state, root);
    if restore_preview { mode_layout::set_preview(state, root, false)?; }
    let result = operation();
    let restore = if restore_preview { mode_layout::set_preview(state, root, true) } else { Ok(()) };
    match (result, restore) {
        (Ok(value), Ok(())) => Ok(value),
        (Err(error), Ok(())) => Err(error),
        (_, Err(error)) => Err(error),
    }
}

#[tauri::command]
fn export_diagnostics(app: AppHandle, csgo: Option<String>) -> Result<diagnostics::DiagnosticArchive> {
    let root = csgo.as_deref().map(csgo_path).transpose()?;
    let snapshot = get_runtime_snapshot(app.clone())?;
    let state = local_state_root(&app)?;
    let source = root.as_deref().map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "panel-only".to_string());
    logging::append(&state, "INFO", "diagnostics.started", &source);
    let snapshot = serde_json::to_value(snapshot)?;
    let result = diagnostics::export(&state, root.as_deref(), &snapshot);
    match &result {
        Ok(value) => logging::append(&state, "INFO", "diagnostics.completed", &format!("{} files: {}", value.files_collected, value.path)),
        Err(error) => logging::append(&state, "ERROR", "diagnostics.failed", &error.detail),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root() -> PathBuf {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("cs2bi-knife-config-{suffix}"))
    }

    #[test]
    fn knife_config_is_clamped_and_written_to_game_plugin_path() {
        let root = test_root();
        let mut config = KnifeCustomizerConfig::default();
        config.enabled = true;
        config.loadouts.ct.default_knife_defindex = 515;
        config.loadouts.ct.knife_presets.insert("515".into(), KnifePreset {
            paint: 568,
            seed: 1200,
            wear: -0.25,
            name_tag: "12345678901234567890extra".into(),
            stattrak_enabled: true,
            stattrak_count: -7,
            souvenir_enabled: false,
        });

        save_knife_config(&root, &mut config).unwrap();

        let saved = read_knife_config(&root).unwrap();
        let preset = &saved.loadouts.ct.knife_presets["515"];
        assert_eq!(saved.schema_version, COSMETICS_SCHEMA_VERSION);
        assert_eq!(saved.loadouts.ct.default_knife_defindex, 515);
        assert_eq!(preset.seed, 1000);
        assert_eq!(preset.wear, 0.0);
        assert_eq!(preset.name_tag, "12345678901234567890");
        assert_eq!(preset.stattrak_count, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn default_knife_requires_a_matching_preset() {
        let mut config = KnifeCustomizerConfig::default();
        config.loadouts.ct.default_knife_defindex = 515;
        let error = normalize_knife_config(&mut config).unwrap_err();
        assert_eq!(error.code, "E1002");
        assert!(error.detail.contains("no saved preset"));
    }

    #[test]
    fn legacy_knife_config_without_glove_remains_readable() {
        let json = r#"{
            "enabled": true,
            "apply_to_human_players": true,
            "apply_to_dropped_knives": true,
            "apply_on_pickup": true,
            "default_knife_defindex": 0,
            "presets": {}
        }"#;
        let mut config: KnifeCustomizerConfig = serde_json::from_str(json).unwrap();
        migrate_legacy_config(&mut config);
        assert!(!serde_json::to_string(&config).unwrap().contains("apply_to_dropped_knives"));
        assert_eq!(config.schema_version, COSMETICS_SCHEMA_VERSION);
        assert!(!config.loadouts.ct.glove.enabled);
        assert_eq!(config.loadouts.t.glove.defindex, DEFAULT_GLOVE_DEFINDEX);
        assert_eq!(config.loadouts.t.glove.paint, DEFAULT_GLOVE_PAINT);
        assert_eq!(config.music_kit_id, 0);
    }

    #[test]
    fn enabling_an_empty_legacy_glove_uses_the_default_preset() {
        let mut config = KnifeCustomizerConfig::default();
        config.loadouts.t.glove = GlovePreset {
            enabled: true,
            defindex: 0,
            paint: 0,
            seed: 0,
            wear: 0.0,
        };

        normalize_knife_config(&mut config).unwrap();

        assert!(config.loadouts.t.glove.enabled);
        assert_eq!(config.loadouts.t.glove.defindex, DEFAULT_GLOVE_DEFINDEX);
        assert_eq!(config.loadouts.t.glove.paint, DEFAULT_GLOVE_PAINT);
        assert_eq!(config.loadouts.t.glove.wear, DEFAULT_GLOVE_WEAR);
    }

    #[test]
    fn atomic_json_write_replaces_an_existing_file() {
        let root = test_root();
        let path = root.join("config.json");
        write_json_atomic(&path, &serde_json::json!({ "value": 1 })).unwrap();
        write_json_atomic(&path, &serde_json::json!({ "value": 2 })).unwrap();

        let saved: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["value"], 2);
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bot_mode_launch_always_includes_insecure_arguments() {
        let (arguments, options) = launch_request(LaunchMode::Bots);
        assert_eq!(arguments, vec!["-applaunch", "730", "-insecure", "-console", "-condebug"]);
        assert_eq!(options, "-insecure -console -condebug");

        let (preview_arguments, preview_options) = launch_request(LaunchMode::Preview);
        assert_eq!(preview_arguments, vec!["-applaunch", "730", "-insecure", "-console", "-condebug"]);
        assert_eq!(preview_options, "-insecure -console -condebug");

        let (online_arguments, online_options) = launch_request(LaunchMode::Online);
        assert_eq!(online_arguments, vec!["-applaunch", "730"]);
        assert!(online_options.is_empty());
    }

    #[test]
    fn online_safety_restores_the_previous_cosmetic_state() {
        let root = test_root();
        let mut config = KnifeCustomizerConfig::default();
        config.enabled = true;
        config.loadouts.ct.default_knife_defindex = 515;
        config.loadouts.ct.knife_presets.insert("515".into(), KnifePreset {
            paint: 568,
            seed: 42,
            wear: 0.12,
            name_tag: "saved".into(),
            stattrak_enabled: true,
            stattrak_count: 99,
            souvenir_enabled: false,
        });
        save_knife_config(&root, &mut config).unwrap();

        let mut app_config = AppConfig::default();
        enter_online_safety(&root, &mut app_config).unwrap();

        let saved = read_knife_config(&root).unwrap();
        assert!(!saved.enabled);
        assert_eq!(saved.loadouts.ct.knife_presets.len(), 1);
        assert_eq!(saved.loadouts.ct.knife_presets["515"].paint, 568);
        assert_eq!(saved.loadouts.ct.knife_presets["515"].stattrak_count, 99);
        leave_online_safety(&root, &mut app_config).unwrap();
        let restored = read_knife_config(&root).unwrap();
        assert!(restored.enabled);
        assert!(app_config.cosmetics_enabled_before_online.is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preview_safety_temporarily_enables_and_restores_cosmetics() {
        let root = test_root();
        let mut config = KnifeCustomizerConfig::default();
        config.enabled = false;
        save_knife_config(&root, &mut config).unwrap();

        let mut app_config = AppConfig::default();
        enter_preview_safety(&root, &mut app_config).unwrap();
        assert!(read_knife_config(&root).unwrap().enabled);
        assert_eq!(app_config.cosmetics_enabled_before_preview, Some(false));

        leave_preview_safety(&root, &mut app_config).unwrap();
        assert!(!read_knife_config(&root).unwrap().enabled);
        assert!(app_config.cosmetics_enabled_before_preview.is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn canonical_operation_restores_preview_layout() {
        let base = test_root();
        let root = base.join("game/csgo");
        let state = base.join("state");
        let managed = root.join("addons/counterstrikesharp/plugins/BotAI/BotAI.dll");
        fs::create_dir_all(managed.parent().unwrap()).unwrap();
        fs::write(&managed, b"managed").unwrap();
        mode_layout::set_preview(&state, &root, true).unwrap();

        with_canonical_layout(&state, &root, || {
            assert!(managed.is_file());
            assert!(!mode_layout::disabled_path(&managed).exists());
            Ok(())
        }).unwrap();

        assert!(!managed.exists());
        assert!(mode_layout::disabled_path(&managed).is_file());
        assert!(mode_layout::layout_healthy(&root, true));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn legacy_file_validation_accepts_preview_disabled_files() {
        let root = test_root();
        let active_required = [
            "gameinfo.gi",
            "addons/counterstrikesharp/plugins/PlayerKnifeCustomizer/PlayerKnifeCustomizer.dll",
            "addons/MetaMod/bin/win64/server.dll",
            "addons/counterstrikesharp/bin/win64/counterstrikesharp.dll",
        ];
        let preview_required = [
            "cfg/my_bot_normal_config.cfg",
            "cfg/my_bot_ffa_config.cfg",
            "addons/counterstrikesharp/plugins/BotAI/BotAI.dll",
            "addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.dll",
        ];
        for relative in active_required {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"active").unwrap();
        }
        for relative in preview_required {
            let path = mode_layout::disabled_path(&root.join(relative));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"disabled").unwrap();
        }

        let report = validate_files_at(None, &root, false).unwrap();

        assert!(report.ok, "preview-disabled files were reported missing: {:?}", report.missing);
        assert!(report.missing.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn difficulty_change_stays_disabled_in_preview_mode() {
        let base = test_root();
        let root = base.join("game/csgo");
        let state = base.join("state");
        let profile = root.join("overrides/High/botprofile.vpk");
        let active = root.join("overrides/botprofile.vpk");
        fs::create_dir_all(profile.parent().unwrap()).unwrap();
        fs::write(&profile, b"high").unwrap();
        fs::write(&active, b"medium").unwrap();
        mode_layout::set_preview(&state, &root, true).unwrap();

        let info = set_difficulty_at(&root, &state, "High", false).unwrap();

        assert_eq!(info.current.as_deref(), Some("High"));
        assert!(!active.exists());
        assert_eq!(fs::read(mode_layout::disabled_path(&active)).unwrap(), b"high");
        assert!(mode_layout::layout_healthy(&root, true));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn panel_round_trip_preserves_gun_presets() {
        let root = test_root();
        let mut config = KnifeCustomizerConfig::default();
        config.music_kit_id = 36;
        config.loadouts.t.gun_presets.insert("7".into(), KnifePreset {
            paint: 661,
            seed: 321,
            wear: 0.08,
            name_tag: String::new(),
            stattrak_enabled: false,
            stattrak_count: 12,
            souvenir_enabled: true,
        });

        save_knife_config(&root, &mut config).unwrap();
        let saved = read_knife_config(&root).unwrap();
        assert_eq!(saved.music_kit_id, 36);
        let ak = &saved.loadouts.t.gun_presets["7"];
        assert_eq!(ak.paint, 661);
        assert_eq!(ak.seed, 321);
        assert!(ak.souvenir_enabled);
        assert!(!ak.stattrak_enabled);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_configs_migrate_by_weapon_side_and_are_backed_up_once() {
        let root = test_root();
        let knife_path = knife_config_path(&root);
        let gun_path = gun_config_path(&root);
        fs::create_dir_all(knife_path.parent().unwrap()).unwrap();
        fs::write(&knife_path, r#"{
            "enabled": true,
            "apply_to_human_players": true,
            "apply_on_pickup": true,
            "default_knife_defindex": 515,
            "presets": {"515":{"paint":568,"seed":0,"wear":0.01,"name_tag":"","stattrak_enabled":false,"stattrak_count":0}},
            "glove":{"enabled":false,"defindex":5030,"paint":10048,"seed":0,"wear":0.01}
        }"#).unwrap();
        fs::write(&gun_path, r#"{
            "7":{"paint":661,"seed":0,"wear":0.01,"name_tag":"","stattrak_enabled":false,"stattrak_count":0},
            "9":{"paint":344,"seed":0,"wear":0.01,"name_tag":"","stattrak_enabled":false,"stattrak_count":0},
            "16":{"paint":309,"seed":0,"wear":0.01,"name_tag":"","stattrak_enabled":false,"stattrak_count":0}
        }"#).unwrap();

        let mut config = read_knife_config(&root).unwrap();
        assert_eq!(config.loadouts.ct.default_knife_defindex, 515);
        assert_eq!(config.loadouts.t.default_knife_defindex, 515);
        assert!(config.loadouts.t.gun_presets.contains_key("7"));
        assert!(!config.loadouts.ct.gun_presets.contains_key("7"));
        assert!(config.loadouts.ct.gun_presets.contains_key("16"));
        assert!(!config.loadouts.t.gun_presets.contains_key("16"));
        assert_eq!(config.loadouts.ct.gun_presets["9"], config.loadouts.t.gun_presets["9"]);
        assert_eq!(config.shared_weapon_links["9"], true);
        assert!(!legacy_backup_path(&knife_path).exists());

        save_knife_config(&root, &mut config).unwrap();
        assert!(legacy_backup_path(&knife_path).exists());
        assert!(legacy_backup_path(&gun_path).exists());
        let backup = fs::read(&legacy_backup_path(&knife_path)).unwrap();
        save_knife_config(&root, &mut config).unwrap();
        assert_eq!(fs::read(legacy_backup_path(&knife_path)).unwrap(), backup);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn linked_shared_weapon_presets_must_match() {
        let mut config = KnifeCustomizerConfig::default();
        let mut left = KnifePreset {
            paint: 344, seed: 0, wear: 0.01, name_tag: String::new(),
            stattrak_enabled: false, stattrak_count: 0, souvenir_enabled: false,
        };
        let mut right = left.clone();
        right.paint = 279;
        config.loadouts.ct.gun_presets.insert("9".into(), left.clone());
        config.loadouts.t.gun_presets.insert("9".into(), right);
        let error = normalize_knife_config(&mut config).unwrap_err();
        assert!(error.detail.contains("must match"));

        config.shared_weapon_links.insert("9".into(), false);
        normalize_knife_config(&mut config).unwrap();
        left.paint = config.loadouts.ct.gun_presets["9"].paint;
        assert_eq!(left.paint, 344);
    }
}

pub fn run() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Ok(root) = app_storage::root() {
            logging::append(&root, "FATAL", "panel.panic", &info.to_string());
        }
        previous_hook(info);
    }));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { if let Some(w) = app.get_webview_window("main") { let _ = w.set_focus(); } }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Ok(root) = app_storage::root() {
                let removed = logging::cleanup(&root).unwrap_or(0);
                let archives_removed = diagnostics::cleanup_archives(&root).unwrap_or(0);
                let update_cache_removed = online_update::cleanup_cache(None).unwrap_or(0);
                logging::append(&root, "INFO", "panel.started", &format!("version=1.4.2.4, logs_collected={removed}, archives_collected={archives_removed}, update_cache_collected={update_cache_removed}"));
            }
            let update_app = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let plugin_version = installed_plugin_version(&update_app);
                if let Err(error) = online_update::check(false, plugin_version.as_deref()) {
                    online_update::record_check_error(&error);
                    if let Ok(root) = app_storage::root() {
                        logging::append(&root, "WARN", "update.startup_check_failed", &format!("host=github.com, {}", error.detail));
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, save_config, detect_directories, select_directory,
            cleanup_backups, validate_files, get_difficulty, set_difficulty, get_mode, set_mode,
            reconcile_launch_options, launch_cs2, reconcile_core_json, get_bot_items, set_bot_item,
            get_presets, set_aim, set_nades, get_drop_knives, set_drop_knives,
            get_knife_customizer, save_knife_customizer, get_runtime_snapshot,
            inspect_installation, get_install_plan, install_payload, repair_payload,
            restore_payload, export_diagnostics, get_panel_memory, save_panel_memory,
            record_panel_error, get_update_snapshot, check_online_updates,
            install_panel_update, install_plugin_update, cancel_update])
        .run(tauri::generate_context!())
        .expect("error while running CS2BotImproverPlus");
}

pub fn maybe_run_update_helper() -> bool { online_update::maybe_apply_panel_update() }
