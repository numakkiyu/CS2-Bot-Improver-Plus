use crate::{AppError, Result, atomic_fs};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, UserAttentionType};

pub const SCHEMA_VERSION: u32 = 1;
const CATALOG_RELATIVE: &str = "addons/counterstrikesharp/plugins/PlusMatchCoordinator/match_catalog.json";
static WATCHERS: OnceLock<Mutex<BTreeMap<PathBuf, RecommendedWatcher>>> = OnceLock::new();
static EMITTED_RESULTS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn session_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{:x}-{:x}", nanos, std::process::id())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MapCatalogEntry {
    pub id: String,
    pub display_name: String,
    pub workshop_name: String,
    pub thumbnail: String,
    pub required_vpk: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeamCatalogEntry {
    pub id: String,
    pub name: String,
    pub badge: String,
    pub ranking: Option<u32>,
    pub players: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MatchCatalog {
    pub schema_version: u32,
    pub catalog_version: String,
    pub freeze_date: String,
    pub source: String,
    pub maps: Vec<MapCatalogEntry>,
    pub teams: Vec<TeamCatalogEntry>,
    pub difficulties: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MatchState { Prepared, Launching, Loading, Warmup, Live, Finished, Interrupted }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayerKind { Human, Bot }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MatchPlayer {
    pub id: String,
    pub name: String,
    pub kind: PlayerKind,
    #[serde(default)]
    pub is_local_player: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MatchRequest {
    pub schema_version: u32,
    pub session_id: String,
    pub created_at_unix: u64,
    pub map_id: String,
    pub player_side: String,
    pub difficulty: String,
    pub opponent_kind: String,
    pub opponent_team_id: Option<String>,
    pub opponent_name: String,
    pub record_demo: bool,
    pub player_team: Vec<MatchPlayer>,
    pub opponent_team: Vec<MatchPlayer>,
    pub result_path: String,
    pub demo_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PrepareMatchInput {
    pub schema_version: u32,
    pub map_id: String,
    pub player_side: String,
    pub difficulty: String,
    pub opponent_kind: String,
    pub opponent_team_id: Option<String>,
    pub record_demo: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DemoStatus {
    pub state: String,
    pub path: Option<String>,
    pub size_bytes: u64,
    pub error_code: Option<String>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MatchResult {
    pub schema_version: u32,
    pub session_id: String,
    pub state: MatchState,
    pub map_id: String,
    pub started_at_unix: u64,
    pub finished_at_unix: u64,
    pub player_score: u32,
    pub opponent_score: u32,
    pub opponent_name: String,
    pub rating_model_version: String,
    pub demo: DemoStatus,
    pub players: Vec<serde_json::Value>,
    pub interruption_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MatchSession {
    pub schema_version: u32,
    pub session_id: String,
    pub state: MatchState,
    pub map_id: String,
    pub opponent_name: String,
    pub created_at_unix: u64,
    pub player_score: u32,
    pub opponent_score: u32,
    pub demo: DemoStatus,
    pub result_path: Option<String>,
}

fn match_root(csgo: &Path) -> PathBuf { csgo.join(".csbip").join("matches") }
fn active_path(csgo: &Path) -> PathBuf { csgo.join(".csbip").join("match-active.json") }

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| AppError::invalid(error.to_string()))?;
    atomic_fs::write_replace(path, &bytes).map_err(AppError::transaction_io)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let bytes = fs::read(path).map_err(AppError::transaction_io)?;
    serde_json::from_slice(&bytes).map_err(|error| AppError::invalid(format!("Invalid {}: {error}", path.display())))
}

pub fn load_catalog(payload_root: &Path, csgo: Option<&Path>) -> Result<MatchCatalog> {
    let candidates = [
        csgo.map(|root| root.join(CATALOG_RELATIVE)),
        Some(payload_root.join(CATALOG_RELATIVE)),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../addons/counterstrikesharp/plugins/PlusMatchCoordinator/match_catalog.json")),
    ];
    let path = candidates.into_iter().flatten().find(|path| path.is_file())
        .ok_or_else(|| AppError::payload("Match catalog is missing from PlusMatchCoordinator"))?;
    let catalog: MatchCatalog = read_json(&path)?;
    if catalog.schema_version != SCHEMA_VERSION || catalog.maps.len() != 10 || catalog.teams.len() < 20 {
        return Err(AppError::invalid("Match catalog schema, map pool, or team catalog is incomplete"));
    }
    Ok(catalog)
}

fn validate_segment(value: &str, label: &str) -> Result<()> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')) {
        return Err(AppError::invalid(format!("Invalid {label}: {value}")));
    }
    Ok(())
}

fn profile_names(csgo: &Path, difficulty: &str) -> Result<Vec<String>> {
    let path = [
        csgo.join("addons/counterstrikesharp/plugins/PlusMatchCoordinator/profiles").join(difficulty).join("botprofile.db"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../overrides").join(difficulty).join("botprofile.db"),
    ].into_iter().find(|path| path.is_file()).ok_or_else(|| AppError::invalid(format!("The {difficulty} bot profile index is missing")))?;
    let source = fs::read_to_string(&path).map_err(|error| AppError::invalid(format!("Cannot read {}: {error}", path.display())))?;
    let mut names = Vec::new();
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") { continue; }
        let mut quoted = trimmed.split('"');
        let _prefix = quoted.next();
        let Some(name) = quoted.next() else { continue; };
        if quoted.next().is_some_and(|tail| !tail.trim().is_empty()) { continue; }
        if !name.is_empty() { names.push(name.to_string()); }
    }
    if names.len() < 100 { return Err(AppError::invalid("The selected difficulty botprofile.db is incomplete")); }
    Ok(names)
}

fn validate_identities(csgo: &Path, names: impl IntoIterator<Item = String>) -> Result<()> {
    let path = csgo.join("addons/BotHider/bot_info.json");
    let identities: serde_json::Map<String, serde_json::Value> = read_json(&path)?;
    let missing = names.into_iter().filter(|name| !identities.contains_key(name)).collect::<Vec<_>>();
    if !missing.is_empty() { return Err(AppError::invalid(format!("BotHider identities are missing: {}", missing.join(", ")))); }
    Ok(())
}

fn shuffled_unique(pool: &[String], count: usize, excluded: &HashSet<String>, seed: u64) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let mut values = pool.iter().filter(|name| {
        let normalized = name.to_ascii_lowercase();
        !excluded.contains(&normalized) && seen.insert(normalized)
    }).cloned().collect::<Vec<_>>();
    values.sort_by_key(|value| {
        let mut hash = seed ^ 0xcbf29ce484222325;
        for byte in value.bytes() { hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3); }
        hash
    });
    if values.len() < count { return Err(AppError::invalid("Not enough unique bot profiles for a 5v5 match")); }
    Ok(values.into_iter().take(count).collect())
}

pub fn prepare(csgo: &Path, payload_root: &Path, input: PrepareMatchInput) -> Result<MatchRequest> {
    if input.schema_version != SCHEMA_VERSION { return Err(AppError::invalid("Unsupported match request schema")); }
    for (value, label) in [(&input.map_id, "map"), (&input.player_side, "side"), (&input.difficulty, "difficulty"), (&input.opponent_kind, "opponent kind")] {
        validate_segment(value, label)?;
    }
    let catalog = load_catalog(payload_root, Some(csgo))?;
    let map = catalog.maps.iter().find(|map| map.id == input.map_id)
        .ok_or_else(|| AppError::invalid("The selected map is not in the Plus match pool"))?;
    let map_file = csgo.join("maps").join(&map.required_vpk);
    if !map_file.is_file() { return Err(AppError::invalid(format!("Selected map is missing: {}", map_file.display()))); }
    if !matches!(input.difficulty.as_str(), "low" | "medium" | "high") { return Err(AppError::invalid("Difficulty must be low, medium, or high")); }
    if !matches!(input.player_side.as_str(), "random" | "ct" | "t") { return Err(AppError::invalid("Player side must be random, ct, or t")); }
    if !matches!(input.opponent_kind.as_str(), "featured_team" | "random") { return Err(AppError::invalid("Opponent kind must be featured_team or random")); }
    if active_path(csgo).is_file() { return Err(AppError::new("E1702", "match", "A match request is already active")); }

    let id = session_id();
    let seed = now() ^ id.bytes().fold(0u64, |value, byte| value.wrapping_mul(131).wrapping_add(byte as u64));
    let profiles = profile_names(csgo, &title_case(&input.difficulty))?;
    let selected_team = if input.opponent_kind == "featured_team" {
        let team_id = input.opponent_team_id.as_deref().ok_or_else(|| AppError::invalid("Select a featured opponent team"))?;
        Some(catalog.teams.iter().find(|team| team.id == team_id).cloned()
            .ok_or_else(|| AppError::invalid("The selected opponent team is not in the frozen catalog"))?)
    } else { None };
    let opponent_names = if let Some(team) = &selected_team { team.players.clone() } else { shuffled_unique(&profiles, 5, &HashSet::new(), seed)? };
    let excluded = opponent_names.iter().map(|name| name.to_ascii_lowercase()).collect::<HashSet<_>>();
    let teammate_names = shuffled_unique(&profiles, 4, &excluded, seed.rotate_left(17))?;
    validate_identities(csgo, opponent_names.iter().chain(teammate_names.iter()).cloned())?;
    let resolved_side = match input.player_side.as_str() { "random" => if seed & 1 == 0 { "ct" } else { "t" }, side => side };
    let directory = match_root(csgo).join(&id);
    let result_path = directory.join("result.json");
    let demo_path = csgo.join("demos").join("csbip").join(format!("{id}.dem"));
    fs::create_dir_all(&directory).map_err(AppError::transaction_io)?;
    fs::create_dir_all(demo_path.parent().unwrap()).map_err(AppError::transaction_io)?;

    let mut player_team = vec![MatchPlayer { id: "player-local".into(), name: "Player".into(), kind: PlayerKind::Human, is_local_player: true }];
    player_team.extend(teammate_names.into_iter().map(|name| MatchPlayer { id: format!("bot-{name}"), name, kind: PlayerKind::Bot, is_local_player: false }));
    let opponent_team = opponent_names.into_iter().map(|name| MatchPlayer { id: format!("bot-{name}"), name, kind: PlayerKind::Bot, is_local_player: false }).collect();
    let request = MatchRequest {
        schema_version: SCHEMA_VERSION, session_id: id, created_at_unix: now(), map_id: input.map_id,
        player_side: resolved_side.into(), difficulty: input.difficulty,
        opponent_kind: input.opponent_kind, opponent_team_id: selected_team.as_ref().map(|team| team.id.clone()),
        opponent_name: selected_team.map(|team| team.name).unwrap_or_else(|| "Random Opponents".into()),
        record_demo: input.record_demo, player_team, opponent_team,
        result_path: result_path.to_string_lossy().into_owned(), demo_path: demo_path.to_string_lossy().into_owned(),
    };
    write_json(&directory.join("request.json"), &request)?;
    write_json(&active_path(csgo), &request)?;
    Ok(request)
}

fn title_case(value: &str) -> String {
    let mut chars = value.chars();
    chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
}

pub fn active(csgo: &Path) -> Result<Option<MatchSession>> {
    let path = active_path(csgo);
    if !path.is_file() { return Ok(None); }
    let request: MatchRequest = read_json(&path)?;
    let result_path = PathBuf::from(&request.result_path);
    if result_path.is_file() {
        return read_json::<MatchResult>(&result_path).map(|result| Some(session_from_result(result, result_path)));
    }
    Ok(Some(session_from_request(&request)))
}

fn session_from_request(request: &MatchRequest) -> MatchSession {
    MatchSession {
        schema_version: SCHEMA_VERSION, session_id: request.session_id.clone(), state: MatchState::Launching,
        map_id: request.map_id.clone(), opponent_name: request.opponent_name.clone(),
        created_at_unix: request.created_at_unix, player_score: 0, opponent_score: 0,
        demo: DemoStatus { state: if request.record_demo { "pending" } else { "disabled" }.into(), path: request.record_demo.then(|| request.demo_path.clone()), size_bytes: 0, error_code: None, detail: None },
        result_path: Some(request.result_path.clone()),
    }
}

fn session_from_result(result: MatchResult, result_path: PathBuf) -> MatchSession {
    MatchSession {
        schema_version: SCHEMA_VERSION,
        session_id: result.session_id,
        state: result.state,
        map_id: result.map_id,
        opponent_name: result.opponent_name,
        created_at_unix: result.started_at_unix,
        player_score: result.player_score,
        opponent_score: result.opponent_score,
        demo: result.demo,
        result_path: Some(result_path.to_string_lossy().into_owned()),
    }
}

fn clear_active_session(csgo: &Path, session_id: &str) {
    let path = active_path(csgo);
    if read_json::<MatchRequest>(&path).ok().is_some_and(|request| request.session_id == session_id) {
        let _ = fs::remove_file(path);
    }
}

pub fn get_result(csgo: &Path, session_id: &str) -> Result<MatchResult> {
    validate_segment(session_id, "session id")?;
    let result = read_json(&match_root(csgo).join(session_id).join("result.json"))?;
    clear_active_session(csgo, session_id);
    Ok(result)
}

pub fn interrupt_active(csgo: &Path, error_code: &str, detail: &str, clear_active: bool) -> Result<Option<MatchResult>> {
    let path = active_path(csgo);
    if !path.is_file() { return Ok(None); }
    let request: MatchRequest = read_json(&path)?;
    let result_path = PathBuf::from(&request.result_path);
    if result_path.is_file() {
        let result = read_json(&result_path)?;
        if clear_active { clear_active_session(csgo, &request.session_id); }
        return Ok(Some(result));
    }
    let mut result = MatchResult {
        schema_version: SCHEMA_VERSION,
        session_id: request.session_id.clone(),
        state: MatchState::Interrupted,
        map_id: request.map_id,
        started_at_unix: request.created_at_unix,
        finished_at_unix: now(),
        player_score: 0,
        opponent_score: 0,
        opponent_name: request.opponent_name,
        rating_model_version: "rating-plus-3.0-proxy-v1".into(),
        demo: DemoStatus {
            state: if request.record_demo { "validating" } else { "disabled" }.into(),
            path: request.record_demo.then_some(request.demo_path),
            size_bytes: 0,
            error_code: None,
            detail: None,
        },
        players: vec![],
        interruption_reason: Some(format!("{error_code}: {detail}")),
    };
    if request.record_demo {
        if result.demo.path.as_ref().is_some_and(|path| Path::new(path).is_file()) {
            validate_demo(&mut result);
        } else {
            result.demo.state = "failed".into();
            result.demo.error_code = Some("DEMO_NOT_CREATED".into());
            result.demo.detail = Some("The match ended before a Demo file was created".into());
        }
    }
    write_json(&result_path, &result)?;
    if clear_active { clear_active_session(csgo, &request.session_id); }
    Ok(Some(result))
}

pub fn history(csgo: &Path) -> Result<Vec<MatchSession>> {
    let mut sessions = Vec::new();
    for entry in fs::read_dir(match_root(csgo)).into_iter().flatten().flatten() {
        if !entry.path().is_dir() { continue; }
        let result_path = entry.path().join("result.json");
        let request_path = entry.path().join("request.json");
        if result_path.is_file() {
            if let Ok(result) = read_json::<MatchResult>(&result_path) {
                sessions.push(session_from_result(result, result_path));
            }
        } else if let Ok(request) = read_json::<MatchRequest>(&request_path) { sessions.push(session_from_request(&request)); }
    }
    sessions.sort_by_key(|session| std::cmp::Reverse(session.created_at_unix));
    Ok(sessions)
}

pub fn delete(csgo: &Path, session_id: &str) -> Result<()> {
    validate_segment(session_id, "session id")?;
    if active(csgo)?.is_some_and(|active| active.session_id == session_id) { return Err(AppError::new("E1702", "match", "An active match cannot be deleted")); }
    let directory = match_root(csgo).join(session_id);
    let canonical_root = fs::canonicalize(match_root(csgo)).map_err(AppError::transaction_io)?;
    let canonical = fs::canonicalize(&directory).map_err(AppError::transaction_io)?;
    if !canonical.starts_with(&canonical_root) { return Err(AppError::invalid("Match history path escapes the managed root")); }
    if let Ok(request) = read_json::<MatchRequest>(&directory.join("request.json")) {
        let demo = PathBuf::from(request.demo_path);
        if demo.is_file() { fs::remove_file(demo).map_err(AppError::transaction_io)?; }
    }
    fs::remove_dir_all(directory).map_err(AppError::transaction_io)
}

pub fn validate_demo(result: &mut MatchResult) {
    if result.demo.state == "disabled" { return; }
    let Some(path) = result.demo.path.as_ref().map(PathBuf::from) else {
        result.demo.state = "failed".into(); result.demo.error_code = Some("DEMO_PATH_MISSING".into()); return;
    };
    let mut stable = None;
    for _ in 0..8 {
        let size = fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or(0);
        if size > 0 && stable == Some(size) { break; }
        stable = Some(size);
        std::thread::sleep(Duration::from_millis(250));
    }
    let size = stable.unwrap_or(0);
    result.demo.size_bytes = size;
    if size < 1024 {
        result.demo.state = "failed".into(); result.demo.error_code = Some("DEMO_TOO_SMALL".into()); result.demo.detail = Some("Demo file did not reach the minimum readable size".into()); return;
    }
    let mut header = [0u8; 8];
    let readable = fs::File::open(&path).and_then(|mut file| file.read_exact(&mut header));
    if readable.is_err() || (!header.starts_with(b"PBDEMS2") && !header.starts_with(b"HL2DEMO")) {
        result.demo.state = "failed".into(); result.demo.error_code = Some("DEMO_HEADER_INVALID".into()); result.demo.detail = Some("Demo header is not recognized as a Source demo".into()); return;
    }
    result.demo.state = "ready".into(); result.demo.error_code = None; result.demo.detail = None;
}

pub fn watch(app: AppHandle, csgo: &Path) -> Result<()> {
    let root = match_root(csgo);
    fs::create_dir_all(&root).map_err(AppError::transaction_io)?;
    let root_key = fs::canonicalize(&root).unwrap_or(root.clone());
    let watchers = WATCHERS.get_or_init(|| Mutex::new(BTreeMap::new()));
    let mut guard = watchers.lock().unwrap_or_else(|error| error.into_inner());
    if guard.contains_key(&root_key) { return Ok(()); }
    let app_for_events = app.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return; };
        if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) { return; }
        for path in event.paths.into_iter().filter(|path| path.file_name().and_then(|name| name.to_str()) == Some("result.json")) {
            let app = app_for_events.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(120));
                let Ok(mut result) = read_json::<MatchResult>(&path) else { return; };
                if matches!(result.demo.state.as_str(), "pending" | "recording" | "validating") {
                    validate_demo(&mut result);
                    let _ = write_json(&path, &result);
                }
                if let Some(csgo) = path.parent().and_then(Path::parent).and_then(Path::parent).and_then(Path::parent) {
                    clear_active_session(csgo, &result.session_id);
                }
                let emitted = EMITTED_RESULTS.get_or_init(|| Mutex::new(HashSet::new()));
                if !emitted.lock().unwrap_or_else(|error| error.into_inner()).insert(path.clone()) {
                    return;
                }
                let _ = app.emit("match-state-changed", &result);
                let _ = app.emit("match-finished", &result);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    if window.set_focus().is_err() { let _ = window.request_user_attention(Some(UserAttentionType::Informational)); }
                }
            });
        }
    }).map_err(|error| AppError::new("E1701", "match", error.to_string()))?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|error| AppError::new("E1701", "match", error.to_string()))?;
    guard.insert(root_key, watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("csbip-match-{label}-{}", std::process::id()))
    }

    #[test]
    fn path_segments_reject_traversal() {
        assert!(validate_segment("../../escape", "session").is_err());
        assert!(validate_segment("de_mirage", "map").is_ok());
    }

    #[test]
    fn random_roster_deduplicates_names_case_insensitively() {
        let pool = ["Bot".into(), "bot".into(), "One".into(), "Two".into(), "Three".into(), "Four".into()];
        let selected = shuffled_unique(&pool, 5, &HashSet::new(), 42).unwrap();
        let normalized = selected.iter().map(|name| name.to_ascii_lowercase()).collect::<HashSet<_>>();
        assert_eq!(normalized.len(), 5);
    }

    #[test]
    fn history_delete_stays_inside_match_root() {
        let csgo = root("delete");
        let directory = match_root(&csgo).join("session-1");
        fs::create_dir_all(&directory).unwrap();
        let request = MatchRequest { schema_version: 1, session_id: "session-1".into(), created_at_unix: 1, map_id: "de_mirage".into(), player_side: "ct".into(), difficulty: "medium".into(), opponent_kind: "random".into(), opponent_team_id: None, opponent_name: "Random Opponents".into(), record_demo: false, player_team: vec![], opponent_team: vec![], result_path: directory.join("result.json").to_string_lossy().into_owned(), demo_path: csgo.join("demos/session-1.dem").to_string_lossy().into_owned() };
        write_json(&directory.join("request.json"), &request).unwrap();
        assert_eq!(history(&csgo).unwrap().len(), 1);
        delete(&csgo, "session-1").unwrap();
        assert!(!directory.exists());
        fs::remove_dir_all(csgo).unwrap();
    }

    #[test]
    fn demo_failure_is_non_fatal_and_structured() {
        let csgo = root("demo");
        fs::create_dir_all(&csgo).unwrap();
        let path = csgo.join("broken.dem");
        fs::write(&path, b"broken").unwrap();
        let mut result = MatchResult { schema_version: 1, session_id: "x".into(), state: MatchState::Finished, map_id: "de_mirage".into(), started_at_unix: 1, finished_at_unix: 2, player_score: 13, opponent_score: 0, opponent_name: "random".into(), rating_model_version: "test".into(), demo: DemoStatus { state: "validating".into(), path: Some(path.to_string_lossy().into_owned()), size_bytes: 0, error_code: None, detail: None }, players: vec![], interruption_reason: None };
        validate_demo(&mut result);
        assert_eq!(result.demo.state, "failed");
        assert_eq!(result.demo.error_code.as_deref(), Some("DEMO_TOO_SMALL"));
        fs::remove_dir_all(csgo).unwrap();
    }

    #[test]
    fn completed_result_is_recovered_from_the_active_request() {
        let csgo = root("recover-result");
        let directory = match_root(&csgo).join("session-1");
        fs::create_dir_all(&directory).unwrap();
        let request = MatchRequest { schema_version: 1, session_id: "session-1".into(), created_at_unix: 1, map_id: "de_mirage".into(), player_side: "ct".into(), difficulty: "medium".into(), opponent_kind: "random".into(), opponent_team_id: None, opponent_name: "Random Opponents".into(), record_demo: false, player_team: vec![], opponent_team: vec![], result_path: directory.join("result.json").to_string_lossy().into_owned(), demo_path: csgo.join("demos/session-1.dem").to_string_lossy().into_owned() };
        write_json(&directory.join("request.json"), &request).unwrap();
        write_json(&active_path(&csgo), &request).unwrap();
        let result = MatchResult { schema_version: 1, session_id: "session-1".into(), state: MatchState::Finished, map_id: "de_mirage".into(), started_at_unix: 1, finished_at_unix: 2, player_score: 13, opponent_score: 8, opponent_name: "Random Opponents".into(), rating_model_version: "test".into(), demo: DemoStatus { state: "disabled".into(), path: None, size_bytes: 0, error_code: None, detail: None }, players: vec![], interruption_reason: None };
        write_json(&directory.join("result.json"), &result).unwrap();

        assert!(active(&csgo).unwrap().is_some_and(|session| session.state == MatchState::Finished));
        assert_eq!(get_result(&csgo, "session-1").unwrap().player_score, 13);
        assert!(!active_path(&csgo).exists());
        fs::remove_dir_all(csgo).unwrap();
    }
}
