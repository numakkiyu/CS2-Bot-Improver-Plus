use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Manager};

mod mode_files;
use mode_files::{apply_launch_mode, contains_metamod_search_path, LaunchMode};

type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, Serialize)]
struct AppError {
    code: &'static str,
    category: &'static str,
    detail: String,
}

impl AppError {
    fn io(detail: impl Into<String>) -> Self {
        Self { code: "E1001", category: "filesystem", detail: detail.into() }
    }
    fn invalid(detail: impl Into<String>) -> Self {
        Self { code: "E1002", category: "validation", detail: detail.into() }
    }
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
    cosmetics_enabled_before_online: Option<bool>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: Some("schinese".into()), difficulty: Some("Medium".into()),
            mode: Some("bots".into()), insecure: true, bot_items: BotItems::default(),
            aim: Some("mixed".into()), nades: Some("normal".into()),
            drop_knife_bind: "\\".into(), drop_knife_subclasses: vec![],
            csgo_path: None, first_run_done: false,
            cosmetics_enabled_before_online: None,
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
struct ModeInfo { current: Option<String>, online_present: bool, bots_present: bool, insecure: bool, user_count: u32, cs2_running: bool, pending: bool }
#[derive(Serialize)]
struct LaunchResult { options: String, insecure: bool }
#[derive(Serialize)]
struct BotItemsState { skins: bool, profiles: bool, agents: bool, music: bool, cfg_present: bool, cs2_running: bool }
#[derive(Serialize)]
struct PresetsState { aim: Option<String>, nades: Option<String>, cfg_present: bool, cs2_running: bool }
#[derive(Serialize)]
struct DropKnivesState { bind_key: String, selected: Vec<u16>, cfg_present: bool, cs2_running: bool }

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
struct KnifeCustomizerConfig {
    enabled: bool,
    apply_to_human_players: bool,
    apply_on_pickup: bool,
    default_knife_defindex: u16,
    presets: BTreeMap<String, KnifePreset>,
    #[serde(default)]
    gun_presets: BTreeMap<String, KnifePreset>,
    #[serde(default)]
    music_kit_id: i32,
    #[serde(default)]
    glove: GlovePreset,
}

impl Default for KnifeCustomizerConfig {
    fn default() -> Self {
        Self { enabled: false, apply_to_human_players: true,
            apply_on_pickup: true, default_knife_defindex: 0, presets: BTreeMap::new(),
            gun_presets: BTreeMap::new(),
            music_kit_id: 0,
            glove: GlovePreset::default() }
    }
}

#[derive(Serialize)]
struct KnifeCustomizerState { plugin_present: bool, config_present: bool, cs2_running: bool, config: KnifeCustomizerConfig }

fn config_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| AppError::io(e.to_string()))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

fn read_config(app: &AppHandle) -> Result<AppConfig> {
    let path = config_path(app)?;
    if !path.exists() { return Ok(AppConfig::default()); }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(value)?)?;
    fs::rename(temp, path)?;
    Ok(())
}

fn write_config(app: &AppHandle, config: &AppConfig) -> Result<()> { write_json_atomic(&config_path(app)?, config) }

fn cs2_running() -> bool {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system.processes().values().any(|p| p.name().eq_ignore_ascii_case("cs2.exe"))
}

fn valid_csgo(path: &Path) -> bool { path.join("gameinfo.gi").is_file() && path.join("cfg").is_dir() }
fn csgo_path(raw: &str) -> Result<PathBuf> {
    let path = PathBuf::from(raw);
    if !valid_csgo(&path) { return Err(AppError::invalid(format!("Not a CS2 game/csgo directory: {raw}"))); }
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
    for drive in ['C', 'D', 'E', 'F', 'G'] {
        let path = format!(r"{}:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\csgo", drive);
        if valid_csgo(Path::new(&path)) && !candidates.contains(&path) { candidates.push(path); }
    }
    let selected = config.csgo_path.clone().filter(|p| valid_csgo(Path::new(p))).or_else(|| candidates.first().cloned());
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

#[tauri::command]
fn cleanup_backups(_csgo: String) -> u32 { 0 }

#[tauri::command]
fn validate_files(csgo: String) -> Result<FilesReport> {
    let root = csgo_path(&csgo)?;
    let required = ["gameinfo.gi", "cfg/my_bot_normal_config.cfg", "cfg/my_bot_ffa_config.cfg",
        "addons/counterstrikesharp/plugins/BotAI/BotAI.dll", "addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.dll"];
    let missing: Vec<String> = required.iter().filter(|p| !root.join(p).is_file()).map(|p| p.to_string()).collect();
    Ok(FilesReport { ok: missing.is_empty(), total: required.len(), present: required.len() - missing.len(), missing, misplaced: None })
}

fn same_file(a: &Path, b: &Path) -> bool { fs::read(a).ok().zip(fs::read(b).ok()).is_some_and(|(a,b)| a == b) }

#[tauri::command]
fn get_difficulty(csgo: String) -> Result<DifficultyInfo> {
    let root = csgo_path(&csgo)?;
    let active = root.join("overrides/botprofile.vpk");
    let current = ["Low", "Medium", "High"].iter().find(|name| same_file(&active, &root.join(format!("overrides/{name}/botprofile.vpk")))).map(|s| s.to_string());
    Ok(DifficultyInfo { current, available: vec!["Low".into(), "Medium".into(), "High".into()], active_present: active.is_file(), cs2_running: cs2_running() })
}

#[tauri::command]
fn set_difficulty(csgo: String, level: String) -> Result<DifficultyInfo> {
    let root = csgo_path(&csgo)?;
    if !["Low", "Medium", "High"].contains(&level.as_str()) { return Err(AppError::invalid("Unknown difficulty")); }
    fs::copy(root.join(format!("overrides/{level}/botprofile.vpk")), root.join("overrides/botprofile.vpk"))?;
    get_difficulty(csgo)
}

#[tauri::command]
fn get_mode(app: AppHandle, csgo: String) -> Result<ModeInfo> {
    let root = csgo_path(&csgo)?;
    let gameinfo = root.join("gameinfo.gi");
    let online_present = root.join("backup/Online/gameinfo.gi").is_file();
    let bots_present = root.join("backup/WithBots/gameinfo.gi").is_file();
    let current = fs::read(&gameinfo).ok().map(|bytes| {
        if contains_metamod_search_path(&bytes) { "bots".into() } else { "online".into() }
    });
    let config = read_config(&app)?;
    Ok(ModeInfo { pending: current != config.mode, current, online_present, bots_present, insecure: config.insecure, user_count: 1, cs2_running: cs2_running() })
}

#[tauri::command]
fn set_mode(app: AppHandle, csgo: String, mode: String) -> Result<ModeInfo> {
    let root = csgo_path(&csgo)?;
    if cs2_running() {
        return Err(AppError::invalid("Close CS2 before switching between normal matchmaking and enhanced bots"));
    }
    let launch_mode = LaunchMode::parse(Some(&mode)).map_err(AppError::invalid)?;
    apply_launch_mode(&root, launch_mode).map_err(AppError::invalid)?;
    let mut config = read_config(&app)?;
    if launch_mode == LaunchMode::Online {
        enter_online_safety(&root, &mut config)?;
    } else {
        leave_online_safety(&root, &mut config)?;
    }
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
        .ok_or_else(|| AppError::invalid("Steam.exe was not found. Start Steam, then try again"))
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
    if cs2_running() {
        return Err(AppError::invalid("CS2 is already running. Close it before changing or launching a mode"));
    }

    let mut config = read_config(&app)?;
    let mode = LaunchMode::parse(config.mode.as_deref()).map_err(AppError::invalid)?;
    let configured_path = config.csgo_path.as_deref()
        .ok_or_else(|| AppError::invalid("Select the CS2 game/csgo directory before launching"))?;
    let root = csgo_path(configured_path)?;
    apply_launch_mode(&root, mode).map_err(AppError::invalid)?;

    if mode == LaunchMode::Online {
        enter_online_safety(&root, &mut config)?;
    } else {
        leave_online_safety(&root, &mut config)?;
    }

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
    let b = read_config(&app)?.bot_items;
    Ok(BotItemsState { skins: b.skins, profiles: b.profiles, agents: b.agents, music: b.music,
        cfg_present: root.join("addons/counterstrikesharp/configs/core.json").is_file(), cs2_running: cs2_running() })
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
    Ok(PresetsState { aim: config.aim, nades: config.nades, cfg_present: cfg_paths(&root).iter().all(|p| p.is_file()), cs2_running: cs2_running() })
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
    Ok(DropKnivesState { bind_key: config.drop_knife_bind, selected: config.drop_knife_subclasses,
        cfg_present: cfg_paths(&root).iter().all(|p| p.is_file()), cs2_running: cs2_running() })
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

fn normalize_knife_config(config: &mut KnifeCustomizerConfig) -> Result<()> {
    config.music_kit_id = config.music_kit_id.clamp(0, u16::MAX as i32);
    for (def, preset) in &mut config.presets {
        let defindex: u16 = def.parse().map_err(|_| AppError::invalid("Invalid knife defindex"))?;
        if !(500..=526).contains(&defindex) || preset.paint <= 0 {
            return Err(AppError::invalid("Invalid knife preset"));
        }
        preset.seed = preset.seed.clamp(0, 1000);
        preset.wear = preset.wear.clamp(0.0, 1.0);
        preset.stattrak_count = preset.stattrak_count.max(0);
        preset.name_tag = preset.name_tag.chars().take(20).collect();
        if preset.souvenir_enabled { preset.stattrak_enabled = false; }
    }
    for (def, preset) in &mut config.gun_presets {
        let defindex: u16 = def.parse().map_err(|_| AppError::invalid("Invalid gun defindex"))?;
        if defindex == 0 || defindex >= 500 || preset.paint <= 0 {
            return Err(AppError::invalid("Invalid gun preset"));
        }
        preset.seed = preset.seed.clamp(0, 1000);
        preset.wear = preset.wear.clamp(0.0, 1.0);
        preset.stattrak_count = preset.stattrak_count.max(0);
        preset.name_tag = preset.name_tag.chars().take(20).collect();
        if preset.souvenir_enabled { preset.stattrak_enabled = false; }
    }

    if config.default_knife_defindex != 0
        && !config.presets.contains_key(&config.default_knife_defindex.to_string())
    {
        return Err(AppError::invalid("Default knife has no saved preset"));
    }
    config.glove.seed = config.glove.seed.clamp(0, 1000);
    config.glove.wear = config.glove.wear.clamp(0.0, 1.0);
    if config.glove.enabled && config.glove.defindex == 0 && config.glove.paint == 0 {
        config.glove = GlovePreset { enabled: true, ..GlovePreset::default() };
    }
    if config.glove.enabled
        && (!(4725..=5035).contains(&config.glove.defindex) || config.glove.paint <= 0)
    {
        return Err(AppError::invalid("Invalid glove preset"));
    }
    Ok(())
}

fn save_knife_config(root: &Path, config: &mut KnifeCustomizerConfig) -> Result<()> {
    normalize_knife_config(config)?;
    write_json_atomic(&knife_config_path(root), config)?;
    write_json_atomic(&gun_config_path(root), &config.gun_presets)
}

fn set_knife_customizer_enabled(root: &Path, enabled: bool) -> Result<Option<bool>> {
    let path = knife_config_path(root);
    if path.is_file() {
        let mut config: KnifeCustomizerConfig = serde_json::from_str(&fs::read_to_string(&path)?)?;
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

#[tauri::command]
fn get_knife_customizer(csgo: String) -> Result<KnifeCustomizerState> {
    let root = csgo_path(&csgo)?;
    let path = knife_config_path(&root);
    let present = path.is_file();
    let mut config = if present { serde_json::from_str(&fs::read_to_string(&path)?)? } else { KnifeCustomizerConfig::default() };
    let gun_path = gun_config_path(&root);
    if gun_path.is_file() {
        config.gun_presets = serde_json::from_str(&fs::read_to_string(gun_path)?)?;
    }
    Ok(KnifeCustomizerState { plugin_present: path.with_file_name("PlayerKnifeCustomizer.dll").is_file(), config_present: present, cs2_running: cs2_running(), config })
}

#[tauri::command]
fn save_knife_customizer(csgo: String, mut config: KnifeCustomizerConfig) -> Result<KnifeCustomizerState> {
    let root = csgo_path(&csgo)?;
    save_knife_config(&root, &mut config)?;
    get_knife_customizer(csgo)
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
        let mut presets = BTreeMap::new();
        presets.insert("515".into(), KnifePreset {
            paint: 568,
            seed: 1200,
            wear: -0.25,
            name_tag: "12345678901234567890extra".into(),
            stattrak_enabled: true,
            stattrak_count: -7,
            souvenir_enabled: false,
        });
        let mut config = KnifeCustomizerConfig {
            enabled: true,
            apply_to_human_players: true,
            apply_on_pickup: true,
            default_knife_defindex: 515,
            presets,
            gun_presets: BTreeMap::new(),
            music_kit_id: 0,
            glove: GlovePreset::default(),
        };

        save_knife_config(&root, &mut config).unwrap();

        let path = knife_config_path(&root);
        let saved: KnifeCustomizerConfig = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let preset = &saved.presets["515"];
        assert_eq!(saved.default_knife_defindex, 515);
        assert_eq!(preset.seed, 1000);
        assert_eq!(preset.wear, 0.0);
        assert_eq!(preset.name_tag, "12345678901234567890");
        assert_eq!(preset.stattrak_count, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn default_knife_requires_a_matching_preset() {
        let mut config = KnifeCustomizerConfig {
            default_knife_defindex: 515,
            ..KnifeCustomizerConfig::default()
        };
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
        let config: KnifeCustomizerConfig = serde_json::from_str(json).unwrap();
        assert!(!serde_json::to_string(&config).unwrap().contains("apply_to_dropped_knives"));
        assert!(!config.glove.enabled);
        assert_eq!(config.glove.defindex, DEFAULT_GLOVE_DEFINDEX);
        assert_eq!(config.glove.paint, DEFAULT_GLOVE_PAINT);
        assert_eq!(config.music_kit_id, 0);
    }

    #[test]
    fn enabling_an_empty_legacy_glove_uses_the_default_preset() {
        let mut config = KnifeCustomizerConfig::default();
        config.glove = GlovePreset {
            enabled: true,
            defindex: 0,
            paint: 0,
            seed: 0,
            wear: 0.0,
        };

        normalize_knife_config(&mut config).unwrap();

        assert!(config.glove.enabled);
        assert_eq!(config.glove.defindex, DEFAULT_GLOVE_DEFINDEX);
        assert_eq!(config.glove.paint, DEFAULT_GLOVE_PAINT);
        assert_eq!(config.glove.wear, DEFAULT_GLOVE_WEAR);
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

        let (online_arguments, online_options) = launch_request(LaunchMode::Online);
        assert_eq!(online_arguments, vec!["-applaunch", "730"]);
        assert!(online_options.is_empty());
    }

    #[test]
    fn online_safety_restores_the_previous_cosmetic_state() {
        let root = test_root();
        let mut presets = BTreeMap::new();
        presets.insert("515".into(), KnifePreset {
            paint: 568,
            seed: 42,
            wear: 0.12,
            name_tag: "saved".into(),
            stattrak_enabled: true,
            stattrak_count: 99,
            souvenir_enabled: false,
        });
        let mut config = KnifeCustomizerConfig {
            enabled: true,
            default_knife_defindex: 515,
            presets,
            ..KnifeCustomizerConfig::default()
        };
        save_knife_config(&root, &mut config).unwrap();

        let mut app_config = AppConfig::default();
        enter_online_safety(&root, &mut app_config).unwrap();

        let saved: KnifeCustomizerConfig = serde_json::from_str(
            &fs::read_to_string(knife_config_path(&root)).unwrap(),
        ).unwrap();
        assert!(!saved.enabled);
        assert_eq!(saved.presets.len(), 1);
        assert_eq!(saved.presets["515"].paint, 568);
        assert_eq!(saved.presets["515"].stattrak_count, 99);
        leave_online_safety(&root, &mut app_config).unwrap();
        let restored: KnifeCustomizerConfig = serde_json::from_str(
            &fs::read_to_string(knife_config_path(&root)).unwrap(),
        ).unwrap();
        assert!(restored.enabled);
        assert!(app_config.cosmetics_enabled_before_online.is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn panel_round_trip_preserves_gun_presets() {
        let root = test_root();
        let mut config = KnifeCustomizerConfig::default();
        config.music_kit_id = 36;
        config.gun_presets.insert("7".into(), KnifePreset {
            paint: 661,
            seed: 321,
            wear: 0.08,
            name_tag: String::new(),
            stattrak_enabled: false,
            stattrak_count: 12,
            souvenir_enabled: true,
        });

        save_knife_config(&root, &mut config).unwrap();
        let saved: KnifeCustomizerConfig =
            serde_json::from_str(&fs::read_to_string(knife_config_path(&root)).unwrap()).unwrap();
        assert_eq!(saved.music_kit_id, 36);
        let ak = &saved.gun_presets["7"];
        assert_eq!(ak.paint, 661);
        assert_eq!(ak.seed, 321);
        assert!(ak.souvenir_enabled);
        assert!(!ak.stattrak_enabled);
        fs::remove_dir_all(root).unwrap();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { if let Some(w) = app.get_webview_window("main") { let _ = w.set_focus(); } }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_config, save_config, detect_directories, select_directory,
            cleanup_backups, validate_files, get_difficulty, set_difficulty, get_mode, set_mode,
            reconcile_launch_options, launch_cs2, reconcile_core_json, get_bot_items, set_bot_item,
            get_presets, set_aim, set_nades, get_drop_knives, set_drop_knives,
            get_knife_customizer, save_knife_customizer])
        .run(tauri::generate_context!())
        .expect("error while running CS2BotImproverPlus");
}
