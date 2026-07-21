use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
#[cfg(windows)]
use winreg::RegKey;

#[derive(Debug, Clone, PartialEq)]
enum KvValue {
    Text(String),
    Object(BTreeMap<String, KvValue>),
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Text(String),
    Open,
    Close,
}

fn tokenize(input: &str) -> Option<Vec<Token>> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            c if c.is_whitespace() => {}
            '/' if chars.peek() == Some(&'/') => {
                chars.next();
                for c in chars.by_ref() {
                    if c == '\n' { break; }
                }
            }
            '{' => tokens.push(Token::Open),
            '}' => tokens.push(Token::Close),
            '"' => {
                let mut value = String::new();
                let mut closed = false;
                while let Some(c) = chars.next() {
                    match c {
                        '"' => { closed = true; break; }
                        '\\' => match chars.next() {
                            Some('"') => value.push('"'),
                            Some('\\') => value.push('\\'),
                            Some(other) => { value.push('\\'); value.push(other); }
                            None => return None,
                        },
                        other => value.push(other),
                    }
                }
                if !closed { return None; }
                tokens.push(Token::Text(value));
            }
            _ => return None,
        }
    }
    Some(tokens)
}

fn parse_object(tokens: &[Token], index: &mut usize, stop_on_close: bool) -> Option<BTreeMap<String, KvValue>> {
    let mut result = BTreeMap::new();
    while *index < tokens.len() {
        if tokens[*index] == Token::Close {
            if !stop_on_close { return None; }
            *index += 1;
            return Some(result);
        }
        let Token::Text(key) = &tokens[*index] else { return None };
        *index += 1;
        let value = match tokens.get(*index)? {
            Token::Text(value) => {
                *index += 1;
                KvValue::Text(value.clone())
            }
            Token::Open => {
                *index += 1;
                KvValue::Object(parse_object(tokens, index, true)?)
            }
            Token::Close => return None,
        };
        result.insert(key.clone(), value);
    }
    if stop_on_close { None } else { Some(result) }
}

fn parse_keyvalues(input: &str) -> Option<BTreeMap<String, KvValue>> {
    let tokens = tokenize(input)?;
    let mut index = 0;
    let result = parse_object(&tokens, &mut index, false)?;
    (index == tokens.len()).then_some(result)
}

fn find_text<'a>(object: &'a BTreeMap<String, KvValue>, key: &str) -> Option<&'a str> {
    for (name, value) in object {
        if name.eq_ignore_ascii_case(key) {
            if let KvValue::Text(text) = value { return Some(text); }
        }
        if let KvValue::Object(child) = value {
            if let Some(text) = find_text(child, key) { return Some(text); }
        }
    }
    None
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SteamAppActivity {
    pub manifest_path: PathBuf,
    pub state_flags: u64,
    pub bytes_to_download: u64,
    pub bytes_downloaded: u64,
    pub bytes_to_stage: u64,
    pub bytes_staged: u64,
    pub staging_size: u64,
    pub busy: bool,
}

impl SteamAppActivity {
    pub(crate) fn evidence(&self) -> String {
        format!(
            "{}; StateFlags={}; download={}/{}; stage={}/{}; staging_size={}",
            self.manifest_path.display(),
            self.state_flags,
            self.bytes_downloaded,
            self.bytes_to_download,
            self.bytes_staged,
            self.bytes_to_stage,
            self.staging_size,
        )
    }
}

pub(crate) fn find_app_730_manifest(target: &Path) -> Option<PathBuf> {
    target
        .ancestors()
        .map(|ancestor| ancestor.join("appmanifest_730.acf"))
        .find(|path| path.is_file())
}

fn numeric_value(root: &BTreeMap<String, KvValue>, key: &str) -> u64 {
    find_text(root, key)
        .and_then(|value| value.parse().ok())
        .unwrap_or_default()
}

pub(crate) fn inspect_app_730_activity(
    target: &Path,
) -> Option<std::result::Result<SteamAppActivity, String>> {
    let manifest_path = find_app_730_manifest(target)?;
    Some((|| {
        let text = fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Cannot read {}: {error}", manifest_path.display()))?;
        let root = parse_keyvalues(&text)
            .ok_or_else(|| format!("Cannot parse {}", manifest_path.display()))?;
        let state_flags = find_text(&root, "StateFlags")
            .ok_or_else(|| format!("StateFlags is missing from {}", manifest_path.display()))?
            .parse::<u64>()
            .map_err(|error| format!("Invalid StateFlags in {}: {error}", manifest_path.display()))?;
        let bytes_to_download = numeric_value(&root, "BytesToDownload");
        let bytes_downloaded = numeric_value(&root, "BytesDownloaded");
        let bytes_to_stage = numeric_value(&root, "BytesToStage");
        let bytes_staged = numeric_value(&root, "BytesStaged");
        let staging_size = numeric_value(&root, "StagingSize");
        let busy = state_flags != 4
            || bytes_downloaded < bytes_to_download
            || bytes_staged < bytes_to_stage
            || staging_size > 0;
        Ok(SteamAppActivity {
            manifest_path,
            state_flags,
            bytes_to_download,
            bytes_downloaded,
            bytes_to_stage,
            bytes_staged,
            staging_size,
            busy,
        })
    })())
}

pub(crate) fn wait_for_app_730_idle(
    target: &Path,
    timeout: Duration,
) -> std::result::Result<Option<SteamAppActivity>, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match inspect_app_730_activity(target) {
            None => return Ok(None),
            Some(Err(error)) => return Err(error),
            Some(Ok(activity)) if !activity.busy => return Ok(Some(activity)),
            Some(Ok(activity)) if Instant::now() >= deadline => {
                return Err(format!("Steam App 730 is still busy: {}", activity.evidence()));
            }
            Some(Ok(_)) => thread::sleep(Duration::from_millis(500)),
        }
    }
}

fn collect_library_paths(object: &BTreeMap<String, KvValue>, output: &mut Vec<PathBuf>) {
    for (name, value) in object {
        if name.eq_ignore_ascii_case("path") {
            if let KvValue::Text(text) = value { output.push(PathBuf::from(text)); }
        }
        if let KvValue::Object(child) = value { collect_library_paths(child, output); }
    }
}

#[cfg(windows)]
fn registry_steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let checks = [
        (HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath", KEY_READ),
        (HKEY_LOCAL_MACHINE, r"Software\Valve\Steam", "InstallPath", KEY_READ | KEY_WOW64_64KEY),
        (HKEY_LOCAL_MACHINE, r"Software\Valve\Steam", "InstallPath", KEY_READ | KEY_WOW64_32KEY),
    ];
    for (hive, key, value, flags) in checks {
        if let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(key, flags) {
            if let Ok(path) = key.get_value::<String, _>(value) { roots.push(PathBuf::from(path)); }
        }
    }
    roots
}

pub(crate) fn client_log_files(names: &[&str]) -> Vec<PathBuf> {
    for root in registry_steam_roots() {
        let logs = root.join("logs");
        if !logs.is_dir() {
            continue;
        }
        let files = names.iter()
            .map(|name| logs.join(name))
            .filter(|path| path.is_file())
            .collect::<Vec<_>>();
        if !files.is_empty() {
            return files;
        }
    }
    Vec::new()
}

#[cfg(not(windows))]
fn registry_steam_roots() -> Vec<PathBuf> { Vec::new() }

fn valid_csgo(path: &Path) -> bool {
    path.join("gameinfo.gi").is_file() && path.join("cfg").is_dir()
}

pub(crate) fn paths_equal(left: &Path, right: &Path) -> bool {
    normalized_path_key(left) == normalized_path_key(right)
}

fn normalized_path_key(path: &Path) -> String {
    let mut key = path.to_string_lossy().replace('/', "\\");
    while key.ends_with('\\') && !is_windows_root(&key) { key.pop(); }
    key.make_ascii_lowercase();
    key
}

fn is_windows_root(path: &str) -> bool {
    path == "\\" || (path.len() == 3 && path.as_bytes()[0].is_ascii_alphabetic()
        && path.as_bytes()[1] == b':' && path.as_bytes()[2] == b'\\')
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| paths_equal(existing, &path)) { paths.push(path); }
}

pub fn detect_cs2_directories() -> Vec<PathBuf> {
    let mut steam_roots = registry_steam_roots();
    for variable in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(root) = std::env::var_os(variable) {
            push_unique(&mut steam_roots, PathBuf::from(root).join("Steam"));
        }
    }

    let mut libraries = Vec::new();
    for steam in steam_roots {
        push_unique(&mut libraries, steam.clone());
        let file = steam.join("steamapps/libraryfolders.vdf");
        if let Ok(text) = fs::read_to_string(file) {
            if let Some(root) = parse_keyvalues(&text) { collect_library_paths(&root, &mut libraries); }
        }
    }

    let mut found = Vec::new();
    for library in libraries {
        let manifest = library.join("steamapps/appmanifest_730.acf");
        let install_dir = fs::read_to_string(&manifest).ok()
            .and_then(|text| parse_keyvalues(&text))
            .and_then(|root| find_text(&root, "installdir").map(str::to_owned))
            .unwrap_or_else(|| "Counter-Strike Global Offensive".to_string());
        let csgo = library.join("steamapps/common").join(install_dir).join("game/csgo");
        if valid_csgo(&csgo) { push_unique(&mut found, csgo); }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_valve_keyvalues() {
        let text = r#""libraryfolders"
        {
            "0" { "path" "C:\\Program Files (x86)\\Steam" "apps" { "730" "1" } }
            "1" { "path" "F:\\Steam 库" }
        }"#;
        let root = parse_keyvalues(text).unwrap();
        let mut paths = Vec::new();
        collect_library_paths(&root, &mut paths);
        assert_eq!(paths.len(), 2);
        assert!(paths[1].to_string_lossy().contains("Steam 库"));
    }

    #[test]
    fn rejects_truncated_keyvalues() {
        assert!(parse_keyvalues(r#""root" { "path" "F:\\Steam""#).is_none());
    }

    #[test]
    fn deduplicates_equivalent_windows_paths() {
        let mut paths = Vec::new();
        push_unique(&mut paths, PathBuf::from(r"D:\steam\steamapps\common\Counter-Strike Global Offensive\game\csgo"));
        push_unique(&mut paths, PathBuf::from("d:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/"));
        assert_eq!(paths.len(), 1);
    }

    #[test]
    fn path_comparison_preserves_unicode_spaces_and_root_boundaries() {
        assert!(paths_equal(
            Path::new(r"F:\Steam 库\steamapps\common\Counter-Strike Global Offensive\game\csgo"),
            Path::new("f:/Steam 库/steamapps/common/Counter-Strike Global Offensive/game/csgo/"),
        ));
        assert!(paths_equal(Path::new(r"C:\"), Path::new("c:/")));
        assert!(!paths_equal(Path::new(r"C:\Steam"), Path::new(r"C:\Steam2")));
    }

    fn activity_root(name: &str) -> (PathBuf, PathBuf) {
        let steamapps = std::env::temp_dir().join(format!(
            "cs2bi-steam-activity-{name}-{}",
            std::process::id()
        ));
        let target = steamapps.join("common/Counter-Strike Global Offensive/game/csgo");
        fs::create_dir_all(&target).unwrap();
        (steamapps, target)
    }

    #[test]
    fn steam_open_idle_manifest_is_not_treated_as_an_install_lock() {
        let (steamapps, target) = activity_root("idle");
        fs::write(
            steamapps.join("appmanifest_730.acf"),
            r#""AppState" { "appid" "730" "StateFlags" "4" "StagingSize" "0" "BytesToDownload" "0" "BytesDownloaded" "0" "BytesToStage" "0" "BytesStaged" "0" }"#,
        )
        .unwrap();

        let activity = wait_for_app_730_idle(&target, Duration::ZERO)
            .unwrap()
            .unwrap();

        assert!(!activity.busy);
        assert_eq!(activity.state_flags, 4);
        fs::remove_dir_all(steamapps).unwrap();
    }

    #[test]
    fn steam_update_or_verification_is_reported_as_busy() {
        let (steamapps, target) = activity_root("busy");
        fs::write(
            steamapps.join("appmanifest_730.acf"),
            r#""AppState" { "appid" "730" "StateFlags" "1026" "StagingSize" "4096" "BytesToDownload" "8192" "BytesDownloaded" "4096" "BytesToStage" "8192" "BytesStaged" "0" }"#,
        )
        .unwrap();

        let error = wait_for_app_730_idle(&target, Duration::ZERO).unwrap_err();

        assert!(error.contains("StateFlags=1026"));
        assert!(error.contains("download=4096/8192"));
        fs::remove_dir_all(steamapps).unwrap();
    }
}
