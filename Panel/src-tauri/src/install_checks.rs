use crate::{Result, atomic_fs, installer, steam};
use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus { Pass, Warn, Fail }

#[derive(Clone, Debug, Serialize)]
pub struct InstallCheckItem {
    pub code: String,
    pub status: CheckStatus,
    pub blocking: bool,
    pub title: String,
    pub evidence: String,
    pub cause: String,
    pub action: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct InstallCheckReport {
    pub schema_version: u32,
    pub generated_at_unix: u64,
    pub target: String,
    pub overall: CheckStatus,
    pub pass_count: usize,
    pub warn_count: usize,
    pub fail_count: usize,
    pub blocking_fail_count: usize,
    pub can_proceed: bool,
    pub checks: Vec<InstallCheckItem>,
}

fn item(code: &str, status: CheckStatus, title: &str, evidence: impl Into<String>, cause: &str, action: &str) -> InstallCheckItem {
    InstallCheckItem { code: code.into(), status, blocking: false, title: title.into(), evidence: evidence.into(), cause: cause.into(), action: action.into() }
}

fn blocker(code: &str, status: CheckStatus, title: &str, evidence: impl Into<String>, cause: &str, action: &str) -> InstallCheckItem {
    InstallCheckItem { blocking: status == CheckStatus::Fail, ..item(code, status, title, evidence, cause, action) }
}

fn file_check(code: &str, title: &str, path: &Path, action: &str) -> InstallCheckItem {
    if path.is_file() {
        let size = fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0);
        item(code, CheckStatus::Pass, title, format!("{} ({size} bytes)", path.display()), "File is present", action)
    } else {
        item(code, CheckStatus::Fail, title, path.display().to_string(), "Required file is missing", action)
    }
}

fn blocking_file_check(code: &str, title: &str, path: &Path, action: &str) -> InstallCheckItem {
    let mut check = file_check(code, title, path, action);
    check.blocking = check.status == CheckStatus::Fail;
    check
}

fn source_file_check(code: &str, title: &str, payload_root: &Path, relative: &str) -> InstallCheckItem {
    blocking_file_check(code, title, &payload_root.join(relative), "Download and extract the complete Plus package again")
}

fn target_file_check(code: &str, title: &str, target: &Path, relative: &str, installed: bool) -> InstallCheckItem {
    let mut check = file_check(code, title, &target.join(relative), "Use Repair installation, then run the checks again");
    if !installed && check.status == CheckStatus::Fail {
        check.status = CheckStatus::Warn;
        check.cause = "The component is not installed in the selected CS2 directory yet".into();
        check.action = "Run installation after every blocking preflight item passes".into();
    }
    check
}

fn atomic_probe(root: &Path, code: &str, title: &str) -> InstallCheckItem {
    let nonce = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let destination = root.join(format!(".csbip-install-check-{}-{nonce}.json", std::process::id()));
    let result = atomic_fs::write_replace(&destination, b"{\"schema_version\":1}")
        .and_then(|_| fs::read(&destination).map(|_| ()))
        .and_then(|_| fs::remove_file(&destination));
    match result {
        Ok(()) => blocker(code, CheckStatus::Pass, title, root.display().to_string(), "Atomic create, replace, read, and cleanup succeeded", "No action required"),
        Err(error) => blocker(code, CheckStatus::Fail, title, format!("{}: {error}", root.display()), "Directory is read-only, locked, or denies atomic rename", "Close CS2, check folder permissions, then run the checks again"),
    }
}

fn pe_machine(path: &Path) -> std::io::Result<u16> {
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(0x3c))?;
    let mut offset = [0u8; 4];
    file.read_exact(&mut offset)?;
    file.seek(SeekFrom::Start(u32::from_le_bytes(offset) as u64 + 4))?;
    let mut machine = [0u8; 2];
    file.read_exact(&mut machine)?;
    Ok(u16::from_le_bytes(machine))
}

fn component_check(code: &str, name: &str, path: PathBuf, missing_status: CheckStatus, blocking: bool) -> InstallCheckItem {
    if !path.is_file() {
        let mut check = item(code, missing_status, name, path.display().to_string(), "Required component is missing", "Use Repair installation, then run the checks again");
        check.blocking = blocking && check.status == CheckStatus::Fail;
        return check;
    }
    let mut check = match pe_machine(&path) {
        Ok(0x8664) => item(code, CheckStatus::Pass, name, format!("{}; PE x64", path.display()), "File and expected architecture are present", "No action required"),
        Ok(machine) => item(code, CheckStatus::Fail, name, format!("{}; PE machine 0x{machine:04x}", path.display()), "Component architecture does not match 64-bit CS2", "Repair installation with the Windows x64 Plus package"),
        Err(error) => item(code, CheckStatus::Fail, name, format!("{}: {error}", path.display()), "Component cannot be read as a PE image", "Repair installation or export diagnostics"),
    };
    check.blocking = blocking && check.status == CheckStatus::Fail;
    check
}

fn managed_component_check(code: &str, name: &str, path: PathBuf, missing_status: CheckStatus, blocking: bool) -> InstallCheckItem {
    if !path.is_file() {
        let mut check = item(code, missing_status, name, path.display().to_string(), "Required managed component is missing", "Use Repair installation, then run the checks again");
        check.blocking = blocking && check.status == CheckStatus::Fail;
        return check;
    }
    let mut check = match fs::read(&path) {
        Ok(bytes) if bytes.windows(4).any(|window| window == b"BSJB") => item(
            code,
            CheckStatus::Pass,
            name,
            format!("{}; managed .NET metadata present", path.display()),
            "The managed assembly is readable and contains a CLR metadata root",
            "No action required",
        ),
        Ok(_) => item(code, CheckStatus::Fail, name, path.display().to_string(), "The file is not a readable managed .NET assembly", "Repair installation with the complete Plus package"),
        Err(error) => item(code, CheckStatus::Fail, name, format!("{}: {error}", path.display()), "The managed assembly cannot be read", "Repair installation or export diagnostics"),
    };
    check.blocking = blocking && check.status == CheckStatus::Fail;
    check
}

pub fn run(payload_root: &Path, state_root: &Path, target: &Path, cs2_running: bool, selected_map: Option<&str>) -> Result<InstallCheckReport> {
    let mut checks = Vec::new();
    checks.push(if target.is_dir() { blocker("INSTALL_TARGET", CheckStatus::Pass, "CS2 game/csgo directory", target.display().to_string(), "Selected directory exists", "No action required") }
        else { blocker("INSTALL_TARGET", CheckStatus::Fail, "CS2 game/csgo directory", target.display().to_string(), "Selected path is unavailable", "Select the CS2 installation root, game directory, or game/csgo directory") });
    let app_manifest = steam::find_app_730_manifest(target);
    checks.push(match app_manifest {
        Some(path) => blocking_file_check("STEAM_APP_730", "Steam App 730 installation", &path, "No action required"),
        None => blocker("STEAM_APP_730", CheckStatus::Fail, "Steam App 730 installation", target.display().to_string(), "appmanifest_730.acf was not found above the selected directory", "Select the CS2 game/csgo directory detected from a Steam library"),
    });
    checks.push(match steam::inspect_app_730_activity(target) {
        None => blocker("STEAM_APP_ACTIVITY", CheckStatus::Fail, "Steam App 730 activity", target.display().to_string(), "Steam installation state could not be located", "Select the CS2 game/csgo directory detected from a Steam library"),
        Some(Err(error)) => blocker("STEAM_APP_ACTIVITY", CheckStatus::Fail, "Steam App 730 activity", error, "The Steam app manifest is unreadable or incomplete", "Close Steam, reopen it, and wait for CS2 verification to finish before retrying"),
        Some(Ok(activity)) if activity.busy => blocker("STEAM_APP_ACTIVITY", CheckStatus::Fail, "Steam App 730 activity", activity.evidence(), "Steam is updating, verifying, staging, or committing CS2 files", "Pause the CS2 download or wait for Steam activity to finish, then run installation again"),
        Some(Ok(activity)) => blocker("STEAM_APP_ACTIVITY", CheckStatus::Pass, "Steam App 730 activity", activity.evidence(), "Steam may remain open because App 730 is idle", "No action required"),
    });
    checks.push(blocking_file_check("GAMEINFO_GI", "gameinfo.gi", &target.join("gameinfo.gi"), "Verify CS2 files in Steam"));
    if let Some(map) = selected_map {
        checks.push(blocking_file_check("MATCH_MAP", "Selected match map", &target.join("maps").join(format!("{map}.vpk")), "Verify CS2 files in Steam or install the selected map"));
    }
    checks.push(if cs2_running { blocker("CS2_PROCESS_LOCK", CheckStatus::Fail, "CS2 process and file locks", "cs2.exe is running", "CS2 can lock plugins, configs, and Demo sessions", "Fully close CS2 and wait for cs2.exe to exit") }
        else { blocker("CS2_PROCESS_LOCK", CheckStatus::Pass, "CS2 process and file locks", "No selected cs2.exe process", "No active game lock detected", "No action required") });
    if target.is_dir() { checks.push(atomic_probe(target, "TARGET_ATOMIC_WRITE", "Target atomic write")); }
    let match_state = target.join(".csbip");
    match fs::create_dir_all(&match_state) {
        Ok(()) => checks.push(atomic_probe(&match_state, "MATCH_STATE_ATOMIC_WRITE", "Match state atomic write")),
        Err(error) => checks.push(blocker("MATCH_STATE_ATOMIC_WRITE", CheckStatus::Fail, "Match state atomic write", format!("{}: {error}", match_state.display()), "The per-installation match state directory cannot be created", "Check CS2 folder permissions and Controlled folder access")),
    }
    checks.push(atomic_probe(state_root, "PANEL_STATE_ATOMIC_WRITE", "Panel state and backup atomic write"));

    match installer::inspect_space_requirements(payload_root, state_root, target) {
        Ok(space) => {
            checks.push(blocker(
                "TARGET_DISK_SPACE",
                if space.available_target_bytes >= space.required_target_bytes { CheckStatus::Pass } else { CheckStatus::Fail },
                "CS2 installation disk space",
                format!("required={} bytes; available={} bytes", space.required_target_bytes, space.available_target_bytes),
                "The transaction needs room for its largest atomic payload replacement and safety margin",
                "Free space on the CS2 drive, then run the checks again",
            ));
            checks.push(blocker(
                "BACKUP_DISK_SPACE",
                if space.available_backup_bytes >= space.required_backup_bytes { CheckStatus::Pass } else { CheckStatus::Fail },
                "Backup disk space",
                format!("{}; required={} bytes; available={} bytes", state_root.display(), space.required_backup_bytes, space.available_backup_bytes),
                "The transaction needs enough room for rollback and preserved originals",
                "Free space on the Panel state drive, then run the checks again",
            ));
        }
        Err(error) => checks.push(blocker(
            "INSTALL_SPACE_PLAN",
            CheckStatus::Fail,
            "Installation space calculation",
            error.detail,
            "The exact target or backup space requirement could not be calculated safely",
            "Resolve the reported path or package error, then run the checks again",
        )),
    }

    match installer::verify_payload_for_target(payload_root, target) {
        Ok(manifest) => checks.push(blocker("PAYLOAD_HASHES", CheckStatus::Pass, "Payload manifest and hashes", format!("version {}; {} entries", manifest.package_version, manifest.entries.len()), "Every payload entry passed SHA-256 verification", "No action required")),
        Err(error) => checks.push(blocker("PAYLOAD_HASHES", CheckStatus::Fail, "Payload manifest and hashes", error.detail, "The package is incomplete or modified", "Use the complete Plus package or download it again")),
    }
    let installed = match installer::inspect(payload_root, state_root, target) {
        Ok(inspection) => {
            checks.push(if inspection.interrupted_transaction { item("TRANSACTION_JOURNAL", CheckStatus::Warn, "Installation transaction journal", "An interrupted journal is present", "A previous transaction did not commit", "Run Repair installation to recover through the existing transaction boundary") }
                else { item("TRANSACTION_JOURNAL", CheckStatus::Pass, "Installation transaction journal", "No interrupted journal", "Transaction state is clean", "No action required") });
            checks.push(if inspection.restore_available { item("BACKUP_READABLE", CheckStatus::Pass, "Installation backup", inspection.backup_path.unwrap_or_default(), "A managed backup record is readable", "No action required") }
                else { item("BACKUP_READABLE", CheckStatus::Warn, "Installation backup", "No readable managed backup", "A clean install may not have an older baseline", "Export diagnostics before replacing an unknown or mixed installation") });
            inspection.installed
        }
        Err(error) => {
            checks.push(blocker("INSTALL_RECORD", CheckStatus::Fail, "Installation record", error.detail, "Managed installation metadata cannot be inspected safely", "Export diagnostics before changing files, then repair the installation metadata"));
            false
        }
    };

    for (code, name, relative) in [
        ("METAMOD_X64", "MetaMod", "addons/metamod/bin/win64/server.dll"),
        ("CSS_X64", "CounterStrikeSharp", "addons/counterstrikesharp/bin/win64/counterstrikesharp.dll"),
        ("CSS_DOTNET_X64", "CounterStrikeSharp .NET runtime", "addons/counterstrikesharp/dotnet/dotnet.exe"),
        ("RAYTRACE_X64", "RayTrace", "addons/RayTrace/bin/win64/RayTrace.dll"),
        ("BOTHIDER_X64", "BotHider", "addons/BotHider/bin/win64/BotHider.dll"),
    ] {
        checks.push(component_check(
            &format!("TARGET_{code}"),
            &format!("Installed {name}"),
            target.join(relative),
            if installed { CheckStatus::Fail } else { CheckStatus::Warn },
            false,
        ));
        checks.push(component_check(
            &format!("PAYLOAD_{code}"),
            &format!("Package {name}"),
            payload_root.join(relative),
            CheckStatus::Fail,
            true,
        ));
    }
    for (code, name, relative) in [
        ("MATCH_COORDINATOR_MANAGED", "PlusMatchCoordinator", "addons/counterstrikesharp/plugins/PlusMatchCoordinator/PlusMatchCoordinator.dll"),
        ("MATCH_CORE_MANAGED", "MatchCore", "addons/counterstrikesharp/plugins/PlusMatchCoordinator/MatchCore.dll"),
        ("BOTHIDER_API_MANAGED", "BotHider API", "addons/counterstrikesharp/shared/BotHiderApi/BotHiderApi.dll"),
    ] {
        checks.push(managed_component_check(
            &format!("TARGET_{code}"),
            &format!("Installed {name}"),
            target.join(relative),
            if installed { CheckStatus::Fail } else { CheckStatus::Warn },
            false,
        ));
        checks.push(managed_component_check(
            &format!("PAYLOAD_{code}"),
            &format!("Package {name}"),
            payload_root.join(relative),
            CheckStatus::Fail,
            true,
        ));
    }
    for (code, title, relative) in [
        ("MATCH_CATALOG", "Match catalog", "addons/counterstrikesharp/plugins/PlusMatchCoordinator/match_catalog.json"),
        ("OPEN_RATING_MODEL", "OpenRating model", "addons/counterstrikesharp/plugins/PlusMatchCoordinator/open-rating-3.0-proxy-v1.json"),
        ("BOTHIDER_IDENTITIES", "BotHider identity catalog", "addons/BotHider/bot_info.json"),
    ] {
        checks.push(target_file_check(&format!("TARGET_{code}"), &format!("Installed {title}"), target, relative, installed));
        checks.push(source_file_check(&format!("PAYLOAD_{code}"), &format!("Package {title}"), payload_root, relative));
    }
    for difficulty in ["Low", "Medium", "High"] {
        let relative = format!("addons/counterstrikesharp/plugins/PlusMatchCoordinator/profiles/{difficulty}/botprofile.db");
        let suffix = difficulty.to_ascii_uppercase();
        checks.push(target_file_check(&format!("TARGET_MATCH_PROFILE_{suffix}"), &format!("Installed {difficulty} match Bot profiles"), target, &relative, installed));
        checks.push(source_file_check(&format!("PAYLOAD_MATCH_PROFILE_{suffix}"), &format!("Package {difficulty} match Bot profiles"), payload_root, &relative));
    }

    let pass_count = checks.iter().filter(|check| check.status == CheckStatus::Pass).count();
    let warn_count = checks.iter().filter(|check| check.status == CheckStatus::Warn).count();
    let fail_count = checks.iter().filter(|check| check.status == CheckStatus::Fail).count();
    let blocking_fail_count = checks.iter().filter(|check| check.status == CheckStatus::Fail && check.blocking).count();
    let can_proceed = blocking_fail_count == 0;
    let overall = if fail_count > 0 { CheckStatus::Fail } else if warn_count > 0 { CheckStatus::Warn } else { CheckStatus::Pass };
    Ok(InstallCheckReport { schema_version: 1, generated_at_unix: SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs(), target: target.to_string_lossy().into_owned(), overall, pass_count, warn_count, fail_count, blocking_fail_count, can_proceed, checks })
}

pub fn persist(state_root: &Path, report: &InstallCheckReport) -> Result<PathBuf> {
    let path = state_root.join("reports").join("install-check-latest.json");
    let bytes = serde_json::to_vec_pretty(report)
        .map_err(|error| crate::AppError::transaction(format!("Cannot serialize installation preflight report: {error}")))?;
    atomic_fs::write_replace(&path, &bytes).map_err(crate::AppError::transaction_io)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_probe_reports_success_for_a_writable_directory() {
        let root = std::env::temp_dir().join(format!("atomic-probe-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let result = atomic_probe(&root, "TEST", "test");
        assert_eq!(result.status, CheckStatus::Pass);
        fs::remove_dir_all(root).unwrap();
    }
}
