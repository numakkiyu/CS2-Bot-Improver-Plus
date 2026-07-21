use crate::{AppError, Result, atomic_fs};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

const MANAGED_FILES: &[&str] = &[
    "addons/counterstrikesharp/plugins/BotAI/BotAI.dll",
    "addons/counterstrikesharp/plugins/BotAimImprover/BotAimImprover.dll",
    "addons/counterstrikesharp/plugins/BotBuy/BotBuy.dll",
    "addons/counterstrikesharp/plugins/BotControllerImpl/BotControllerImpl.dll",
    "addons/counterstrikesharp/plugins/BotHiderImpl/BotHiderImpl.dll",
    "addons/counterstrikesharp/plugins/BotRandomizer/BotRandomizer.dll",
    "addons/counterstrikesharp/plugins/BotState/BotState.dll",
    "addons/counterstrikesharp/plugins/NadeSystem/NadeSystem.dll",
    "addons/counterstrikesharp/plugins/RayTraceImpl/RayTraceImpl.dll",
    "addons/counterstrikesharp/plugins/RoundDamageRecap/RoundDamageRecap.dll",
    "addons/counterstrikesharp/plugins/PlusMatchCoordinator/PlusMatchCoordinator.dll",
    "addons/counterstrikesharp/plugins/PlusMatchCoordinator/match_catalog.json",
    "addons/counterstrikesharp/plugins/PlusMatchCoordinator/open-rating-3.0-proxy-v1.json",
    "addons/metamod/BotController.vdf",
    "addons/metamod/BotHider.vdf",
    "addons/metamod/RayTrace.vdf",
    "cfg/my_bot_normal_config.cfg",
    "cfg/my_bot_ffa_config.cfg",
    "overrides/botprofile.vpk",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LayoutJournal {
    schema_version: u8,
    target: String,
    preview: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LayoutState {
    schema_version: u8,
    target: String,
    preview: bool,
}

fn installation_id(target: &Path) -> String {
    let normalized = target
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    format!("{:x}", Sha256::digest(normalized.as_bytes()))
}

fn state_directory(state_root: &Path, target: &Path) -> PathBuf {
    state_root.join("modes").join(installation_id(target))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| AppError::transaction(error.to_string()))?;
    atomic_fs::write_replace(path, &bytes).map_err(AppError::transaction_io)
}

pub(crate) fn disabled_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().map(OsString::from).unwrap_or_default();
    name.push(".csbip-disabled");
    path.with_file_name(name)
}

fn apply_layout(target: &Path, preview: bool) -> Result<()> {
    for relative in MANAGED_FILES {
        let canonical = target.join(relative);
        let disabled = disabled_path(&canonical);
        let (source, destination) = if preview {
            (&canonical, &disabled)
        } else {
            (&disabled, &canonical)
        };

        match (source.exists(), destination.exists()) {
            (true, false) => {
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(AppError::transaction_io)?;
                }
                fs::rename(source, destination).map_err(|error| {
                    AppError::transaction(format!(
                        "Cannot switch managed mode file ({} -> {}): {error}",
                        source.display(),
                        destination.display()
                    ))
                })?;
            }
            (true, true) => {
                // A settings write or interrupted upgrade can create a fresh
                // active file beside the managed disabled copy. The active
                // file is the newest requested content, so retain it while
                // converging to the requested layout.
                if preview {
                    atomic_fs::replace(&canonical, &disabled).map_err(|error| {
                        AppError::transaction(format!(
                            "Cannot reconcile managed preview file ({}): {error}",
                            canonical.display()
                        ))
                    })?;
                } else {
                    fs::remove_file(&disabled).map_err(|error| {
                        AppError::transaction(format!(
                            "Cannot remove stale disabled mode file ({}): {error}",
                            disabled.display()
                        ))
                    })?;
                }
            }
            (false, _) => {}
        }
    }
    Ok(())
}

pub(crate) fn write_managed_file(
    target: &Path,
    relative: &str,
    bytes: &[u8],
    preview: bool,
) -> Result<()> {
    if !MANAGED_FILES.contains(&relative) {
        return Err(AppError::transaction(format!(
            "Refusing to write an unmanaged mode file: {relative}"
        )));
    }
    let canonical = target.join(relative);
    let disabled = disabled_path(&canonical);
    let (destination, stale) = if preview {
        (&disabled, &canonical)
    } else {
        (&canonical, &disabled)
    };
    atomic_fs::write_replace(destination, bytes).map_err(AppError::transaction_io)?;
    if stale.is_file() {
        fs::remove_file(stale).map_err(AppError::transaction_io)?;
    }
    Ok(())
}

pub(crate) fn active_or_disabled(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        Some(path.to_path_buf())
    } else {
        let disabled = disabled_path(path);
        disabled.is_file().then_some(disabled)
    }
}

fn inferred_preview(target: &Path) -> bool {
    let mut disabled = 0usize;
    let mut active = 0usize;
    for relative in MANAGED_FILES {
        let canonical = target.join(relative);
        active += usize::from(canonical.is_file());
        disabled += usize::from(disabled_path(&canonical).is_file());
    }
    disabled > 0 && active == 0
}

pub(crate) fn recover(state_root: &Path, target: &Path) -> Result<()> {
    let directory = state_directory(state_root, target);
    let journal_path = directory.join("transaction.json");
    if !journal_path.is_file() {
        return Ok(());
    }
    let journal: LayoutJournal =
        serde_json::from_slice(&fs::read(&journal_path).map_err(AppError::transaction_io)?)
            .map_err(|error| AppError::transaction(format!("Invalid mode transaction: {error}")))?;
    if journal.target != target.to_string_lossy() {
        return Err(AppError::transaction(
            "Mode transaction belongs to another CS2 installation",
        ));
    }
    apply_layout(target, journal.preview)?;
    let state = LayoutState {
        schema_version: 1,
        target: journal.target,
        preview: journal.preview,
    };
    write_json(&directory.join("active.json"), &state)?;
    fs::remove_file(journal_path).map_err(AppError::transaction_io)
}

pub(crate) fn set_preview(state_root: &Path, target: &Path, preview: bool) -> Result<()> {
    recover(state_root, target)?;
    let directory = state_directory(state_root, target);
    fs::create_dir_all(&directory).map_err(AppError::transaction_io)?;
    let target_text = target.to_string_lossy().into_owned();
    write_json(
        &directory.join("transaction.json"),
        &LayoutJournal {
            schema_version: 1,
            target: target_text.clone(),
            preview,
        },
    )?;
    apply_layout(target, preview)?;
    write_json(
        &directory.join("active.json"),
        &LayoutState {
            schema_version: 1,
            target: target_text,
            preview,
        },
    )?;
    fs::remove_file(directory.join("transaction.json")).map_err(AppError::transaction_io)
}

pub(crate) fn is_preview(state_root: &Path, target: &Path) -> bool {
    let path = state_directory(state_root, target).join("active.json");
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LayoutState>(&bytes).ok())
        .is_some_and(|state| state.preview && state.target == target.to_string_lossy())
        || inferred_preview(target)
}

pub(crate) fn layout_healthy(target: &Path, preview: bool) -> bool {
    MANAGED_FILES.iter().all(|relative| {
        let canonical = target.join(relative);
        let disabled = disabled_path(&canonical);
        if !canonical.exists() && !disabled.exists() {
            return true;
        }
        if preview {
            !canonical.exists() && disabled.exists()
        } else {
            canonical.exists() && !disabled.exists()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "cs2bi-mode-layout-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn preview_disables_only_managed_files_and_roundtrips() {
        let base = root();
        let target = base.join("game/csgo");
        let state = base.join("state");
        let managed = target.join(MANAGED_FILES[0]);
        let foreign = target.join("addons/counterstrikesharp/plugins/Foreign/Foreign.dll");
        fs::create_dir_all(managed.parent().unwrap()).unwrap();
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        fs::write(&managed, b"managed").unwrap();
        fs::write(&foreign, b"foreign").unwrap();

        set_preview(&state, &target, true).unwrap();
        assert!(!managed.exists());
        assert_eq!(fs::read(disabled_path(&managed)).unwrap(), b"managed");
        assert!(foreign.is_file());
        assert!(layout_healthy(&target, true));

        set_preview(&state, &target, false).unwrap();
        assert_eq!(fs::read(&managed).unwrap(), b"managed");
        assert!(!disabled_path(&managed).exists());
        assert!(foreign.is_file());
        assert!(layout_healthy(&target, false));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn recovery_finishes_an_interrupted_layout() {
        let base = root();
        let target = base.join("game/csgo");
        let state = base.join("state");
        let managed = target.join(MANAGED_FILES[0]);
        fs::create_dir_all(managed.parent().unwrap()).unwrap();
        fs::write(&managed, b"managed").unwrap();
        let directory = state_directory(&state, &target);
        fs::create_dir_all(&directory).unwrap();
        write_json(
            &directory.join("transaction.json"),
            &LayoutJournal {
                schema_version: 1,
                target: target.to_string_lossy().into_owned(),
                preview: true,
            },
        )
        .unwrap();

        recover(&state, &target).unwrap();
        assert!(disabled_path(&managed).is_file());
        assert!(!directory.join("transaction.json").exists());
        assert!(is_preview(&state, &target));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn preview_reconciles_an_active_file_created_beside_a_disabled_file() {
        let base = root();
        let target = base.join("game/csgo");
        let state = base.join("state");
        let managed = target.join("overrides/botprofile.vpk");
        let disabled = disabled_path(&managed);
        fs::create_dir_all(managed.parent().unwrap()).unwrap();
        fs::write(&disabled, b"old difficulty").unwrap();
        fs::write(&managed, b"new difficulty").unwrap();

        set_preview(&state, &target, true).unwrap();

        assert!(!managed.exists());
        assert_eq!(fs::read(&disabled).unwrap(), b"new difficulty");
        assert!(layout_healthy(&target, true));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn preview_layout_is_inferred_after_the_portable_panel_is_moved() {
        let base = root();
        let target = base.join("game/csgo");
        let old_state = base.join("old-panel-state");
        let new_state = base.join("new-panel-state");
        let managed = target.join(MANAGED_FILES[0]);
        fs::create_dir_all(managed.parent().unwrap()).unwrap();
        fs::write(&managed, b"managed").unwrap();
        set_preview(&old_state, &target, true).unwrap();

        assert!(is_preview(&new_state, &target));
        fs::remove_dir_all(base).unwrap();
    }
}
