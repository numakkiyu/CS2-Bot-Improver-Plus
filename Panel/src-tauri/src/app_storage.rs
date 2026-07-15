use crate::{AppError, Result, atomic_fs};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub const STATE_DIRECTORY: &str = ".csbip";
static HIDDEN_INITIALIZED: OnceLock<()> = OnceLock::new();

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

pub fn root() -> Result<PathBuf> {
    let path = if let Some(override_path) = std::env::var_os("CS2BI_STATE_ROOT") {
        PathBuf::from(override_path)
    } else {
        let executable = std::env::current_exe()
            .map_err(|error| AppError::transaction(format!("Cannot locate Panel executable: {error}")))?;
        executable.parent()
            .ok_or_else(|| AppError::transaction("Panel executable has no parent directory"))?
            .join(STATE_DIRECTORY)
    };
    fs::create_dir_all(&path).map_err(AppError::transaction_io)?;
    HIDDEN_INITIALIZED.get_or_init(|| hide_directory(&path));
    Ok(path)
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
    fn ui_memory_and_cosmetics_are_stored_under_portable_root() {
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
