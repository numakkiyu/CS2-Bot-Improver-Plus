use crate::{AppError, Result, atomic_fs};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(not(test))]
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const STATE_DIRECTORY: &str = ".csbip";
#[cfg(not(test))]
static HIDDEN_INITIALIZED: OnceLock<()> = OnceLock::new();
#[cfg(not(test))]
static RESOLVED_ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);
#[cfg(test)]
pub(crate) static TEST_STATE_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UiMemory {
    pub schema_version: u32,
    pub saved_at: u64,
    pub entries: BTreeMap<String, String>,
}

fn unix_time() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    atomic_fs::write_replace(path, bytes).map_err(AppError::transaction_io)
}

#[cfg(windows)]
fn hide_directory(path: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("attrib.exe")
        .arg("+H")
        .arg(path)
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn hide_directory(_path: &Path) {}

fn ensure_writable(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)?;
    let probe = path.join(format!(
        ".state-write-probe-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
    ));
    atomic_fs::write_replace(&probe, b"state-write-probe")?;
    let result = fs::read(&probe).and_then(|bytes| {
        if bytes == b"state-write-probe" {
            Ok(())
        } else {
            Err(std::io::Error::other("state write probe returned unexpected data"))
        }
    });
    let cleanup = fs::remove_file(&probe);
    result.and(cleanup)
}

fn fallback_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|home| PathBuf::from(home).join("AppData").join("Local").into_os_string())
        })
        .map(PathBuf::from)
        .map(|root| root.join("CS2BotImproverPlus").join(STATE_DIRECTORY))
}

fn resolve_writable_root(portable: PathBuf, fallback: Option<PathBuf>) -> Result<PathBuf> {
    if ensure_writable(&portable).is_ok() {
        return Ok(portable);
    }

    let fallback = fallback.ok_or_else(|| {
        AppError::transaction(format!(
            "The portable state directory is not writable ({}) and no per-user Local AppData directory is available",
            portable.display()
        ))
    })?;
    ensure_writable(&fallback).map_err(|error| {
        AppError::transaction(format!(
            "Neither the portable state directory ({}) nor the per-user state directory ({}) is writable: {error}",
            portable.display(),
            fallback.display()
        ))
    })?;
    Ok(fallback)
}

fn resolve_root() -> Result<PathBuf> {
    if let Some(override_path) = std::env::var_os("CS2BI_STATE_ROOT") {
        let path = PathBuf::from(override_path);
        ensure_writable(&path).map_err(|error| {
            AppError::transaction(format!(
                "CS2BI_STATE_ROOT is not writable ({}): {error}",
                path.display()
            ))
        })?;
        return Ok(path);
    }

    let executable = std::env::current_exe()
        .map_err(|error| AppError::transaction(format!("Cannot locate Panel executable: {error}")))?;
    let portable = executable.parent()
        .ok_or_else(|| AppError::transaction("Panel executable has no parent directory"))?
        .join(STATE_DIRECTORY);
    resolve_writable_root(portable, fallback_root())
}

pub fn root() -> Result<PathBuf> {
    #[cfg(test)]
    {
        let path = resolve_root()?;
        hide_directory(&path);
        Ok(path)
    }
    #[cfg(not(test))]
    {
        let path = {
            let mut resolved = RESOLVED_ROOT.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(path) = resolved.as_ref() {
                path.clone()
            } else {
                let path = resolve_root()?;
                *resolved = Some(path.clone());
                path
            }
        };
        HIDDEN_INITIALIZED.get_or_init(|| hide_directory(&path));
        Ok(path)
    }
}

pub fn panel_config_path() -> Result<PathBuf> {
    Ok(root()?.join("config").join("panel.json"))
}

pub fn read_ui_memory() -> Result<UiMemory> {
    let path = root()?.join("memory").join("ui-state.json");
    if !path.is_file() {
        return Ok(UiMemory { schema_version: 1, ..UiMemory::default() });
    }
    let bytes = fs::read(&path).map_err(AppError::transaction_io)?;
    let memory = serde_json::from_slice(&bytes)
        .map_err(|error| AppError::invalid(format!("Invalid Panel UI memory: {error}")))?;
    Ok(memory)
}

pub fn write_ui_memory(entries: BTreeMap<String, String>) -> Result<UiMemory> {
    let memory = UiMemory { schema_version: 1, saved_at: unix_time(), entries };
    let bytes = serde_json::to_vec_pretty(&memory)
        .map_err(|error| AppError::transaction(error.to_string()))?;
    write_atomic(&root()?.join("memory").join("ui-state.json"), &bytes)?;
    Ok(memory)
}

fn copy_atomic(source: &Path, destination: &Path) -> Result<()> {
    let bytes = fs::read(source).map_err(AppError::transaction_io)?;
    write_atomic(destination, &bytes)
}

pub fn mirror_cosmetics(csgo: &Path) -> Result<usize> {
    let source = csgo.join("addons/counterstrikesharp/plugins/PlayerKnifeCustomizer");
    let destination = root()?.join("presets").join("current");
    let mut copied = 0;
    for name in ["player_knife_presets.json", "player_gun_presets.json"] {
        let from = source.join(name);
        if from.is_file() {
            copy_atomic(&from, &destination.join(name))?;
            copied += 1;
        }
    }
    if copied > 0 {
        let metadata = serde_json::to_vec_pretty(&serde_json::json!({
            "schema_version": 1,
            "saved_at": unix_time(),
            "source": csgo.to_string_lossy(),
            "files_copied": copied,
        })).map_err(|error| AppError::transaction(error.to_string()))?;
        write_atomic(&destination.join("mirror.json"), &metadata)?;
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_portable_location_uses_per_user_fallback() {
        let base = std::env::temp_dir().join(format!("cs2bi-storage-fallback-{}", unix_time()));
        let portable = base.join("portable-state");
        let fallback = base.join("local-app-data-state");
        fs::create_dir_all(&base).unwrap();
        fs::write(&portable, b"occupied by a file").unwrap();

        let resolved = resolve_writable_root(portable, Some(fallback.clone())).unwrap();
        assert_eq!(resolved, fallback);
        assert!(resolved.is_dir());

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn ui_memory_and_cosmetics_are_stored_under_portable_root() {
        let _guard = TEST_STATE_ENV_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let base = std::env::temp_dir().join(format!("cs2bi-storage-{}", unix_time()));
        unsafe { std::env::set_var("CS2BI_STATE_ROOT", &base); }
        let mut entries = BTreeMap::new();
        entries.insert("cs2bi.cosmeticsTeam".to_string(), "t".to_string());
        write_ui_memory(entries.clone()).unwrap();
        assert_eq!(read_ui_memory().unwrap().entries, entries);

        let csgo = base.join("fake-csgo");
        let cosmetics = csgo.join("addons/counterstrikesharp/plugins/PlayerKnifeCustomizer");
        fs::create_dir_all(&cosmetics).unwrap();
        fs::write(cosmetics.join("player_knife_presets.json"), b"{}").unwrap();
        assert_eq!(mirror_cosmetics(&csgo).unwrap(), 1);
        assert!(base.join("presets/current/player_knife_presets.json").is_file());
        fs::remove_dir_all(&base).unwrap();
        unsafe { std::env::remove_var("CS2BI_STATE_ROOT"); }
    }
}
