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
    pub checks: Vec<InstallCheckItem>,
}

fn item(code: &str, status: CheckStatus, title: &str, evidence: impl Into<String>, cause: &str, action: &str) -> InstallCheckItem {
    InstallCheckItem { code: code.into(), status, title: title.into(), evidence: evidence.into(), cause: cause.into(), action: action.into() }
}

fn file_check(code: &str, title: &str, path: &Path, action: &str) -> InstallCheckItem {
    if path.is_file() {
        let size = fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0);
        item(code, CheckStatus::Pass, title, format!("{} ({size} bytes)", path.display()), "File is present", action)
    } else {
        item(code, CheckStatus::Fail, title, path.display().to_string(), "Required file is missing", action)
    }
}

fn atomic_probe(root: &Path, code: &str, title: &str) -> InstallCheckItem {
    let destination = root.join(".csbip-install-check.json");
    let result = atomic_fs::write_replace(&destination, b"{\"schema_version\":1}")
        .and_then(|_| fs::read(&destination).map(|_| ()))
        .and_then(|_| fs::remove_file(&destination));
    match result {
        Ok(()) => item(code, CheckStatus::Pass, title, root.display().to_string(), "Atomic create, replace, read, and cleanup succeeded", "No action required"),
        Err(error) => item(code, CheckStatus::Fail, title, format!("{}: {error}", root.display()), "Directory is read-only, locked, or denies atomic rename", "Close CS2, check folder permissions, then run the checks again"),
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

fn component_check(code: &str, name: &str, path: PathBuf) -> InstallCheckItem {
    if !path.is_file() {
        return item(code, CheckStatus::Fail, name, path.display().to_string(), "Required component is missing", "Use Repair installation, then run the checks again");
    }
    match pe_machine(&path) {
        Ok(0x8664) => item(code, CheckStatus::Pass, name, format!("{}; PE x64", path.display()), "File and expected architecture are present", "No action required"),
        Ok(machine) => item(code, CheckStatus::Fail, name, format!("{}; PE machine 0x{machine:04x}", path.display()), "Component architecture does not match 64-bit CS2", "Repair installation with the Windows x64 Plus package"),
        Err(error) => item(code, CheckStatus::Fail, name, format!("{}: {error}", path.display()), "Component cannot be read as a PE image", "Repair installation or export diagnostics"),
    }
}

pub fn run(payload_root: &Path, state_root: &Path, target: &Path, cs2_running: bool, selected_map: Option<&str>) -> Result<InstallCheckReport> {
    let mut checks = Vec::new();
    checks.push(if target.is_dir() { item("INSTALL_TARGET", CheckStatus::Pass, "CS2 game/csgo directory", target.display().to_string(), "Selected directory exists", "No action required") }
        else { item("INSTALL_TARGET", CheckStatus::Fail, "CS2 game/csgo directory", target.display().to_string(), "Selected path is unavailable", "Select the correct game/csgo directory") });
    let app_manifest = steam::find_app_730_manifest(target);
    checks.push(match app_manifest {
        Some(path) => file_check("STEAM_APP_730", "Steam App 730 installation", &path, "No action required"),
        None => item("STEAM_APP_730", CheckStatus::Fail, "Steam App 730 installation", target.display().to_string(), "appmanifest_730.acf was not found above the selected directory", "Select the CS2 game/csgo directory detected from a Steam library"),
    });
    checks.push(match steam::inspect_app_730_activity(target) {
        None => item("STEAM_APP_ACTIVITY", CheckStatus::Fail, "Steam App 730 activity", target.display().to_string(), "Steam installation state could not be located", "Select the CS2 game/csgo directory detected from a Steam library"),
        Some(Err(error)) => item("STEAM_APP_ACTIVITY", CheckStatus::Fail, "Steam App 730 activity", error, "The Steam app manifest is unreadable or incomplete", "Close Steam, reopen it, and wait for CS2 verification to finish before retrying"),
        Some(Ok(activity)) if activity.busy => item("STEAM_APP_ACTIVITY", CheckStatus::Fail, "Steam App 730 activity", activity.evidence(), "Steam is updating, verifying, staging, or committing CS2 files", "Pause the CS2 download or wait for Steam activity to finish, then run installation again"),
        Some(Ok(activity)) => item("STEAM_APP_ACTIVITY", CheckStatus::Pass, "Steam App 730 activity", activity.evidence(), "Steam may remain open because App 730 is idle", "No action required"),
    });
    checks.push(file_check("GAMEINFO_GI", "gameinfo.gi", &target.join("gameinfo.gi"), "Verify CS2 files in Steam"));
    if let Some(map) = selected_map {
        checks.push(file_check("MATCH_MAP", "Selected match map", &target.join("maps").join(format!("{map}.vpk")), "Verify CS2 files in Steam or install the selected map"));
    }
    checks.push(if cs2_running { item("CS2_PROCESS_LOCK", CheckStatus::Fail, "CS2 process and file locks", "cs2.exe is running", "CS2 can lock plugins, configs, and Demo sessions", "Fully close CS2 and wait for cs2.exe to exit") }
        else { item("CS2_PROCESS_LOCK", CheckStatus::Pass, "CS2 process and file locks", "No selected cs2.exe process", "No active game lock detected", "No action required") });
    if target.is_dir() { checks.push(atomic_probe(target, "TARGET_ATOMIC_WRITE", "Target atomic write")); }
    if fs::create_dir_all(target.join(".csbip")).is_ok() { checks.push(atomic_probe(&target.join(".csbip"), "STATE_ATOMIC_WRITE", "Match state atomic write")); }

    match fs2::available_space(target) {
        Ok(bytes) if bytes >= 2 * 1024 * 1024 * 1024 => checks.push(item("DISK_SPACE", CheckStatus::Pass, "Free disk space", format!("{bytes} bytes available"), "Space is sufficient for installation and Demos", "No action required")),
        Ok(bytes) => checks.push(item("DISK_SPACE", CheckStatus::Warn, "Free disk space", format!("{bytes} bytes available"), "Less than 2 GiB remains for payload backups and Demos", "Free disk space before recording long matches")),
        Err(error) => checks.push(item("DISK_SPACE", CheckStatus::Fail, "Free disk space", error.to_string(), "Disk availability could not be queried", "Check the drive, then export diagnostics")),
    }

    match installer::verify_payload(payload_root) {
        Ok(manifest) => checks.push(item("PAYLOAD_HASHES", CheckStatus::Pass, "Payload manifest and hashes", format!("version {}; {} entries", manifest.package_version, manifest.entries.len()), "Every payload entry passed SHA-256 verification", "No action required")),
        Err(error) => checks.push(item("PAYLOAD_HASHES", CheckStatus::Fail, "Payload manifest and hashes", error.detail, "The package is incomplete or modified", "Use the complete Plus package or download it again")),
    }
    match installer::inspect(payload_root, state_root, target) {
        Ok(inspection) => {
            checks.push(if inspection.interrupted_transaction { item("TRANSACTION_JOURNAL", CheckStatus::Warn, "Installation transaction journal", "An interrupted journal is present", "A previous transaction did not commit", "Run Repair installation to recover through the existing transaction boundary") }
                else { item("TRANSACTION_JOURNAL", CheckStatus::Pass, "Installation transaction journal", "No interrupted journal", "Transaction state is clean", "No action required") });
            checks.push(if inspection.restore_available { item("BACKUP_READABLE", CheckStatus::Pass, "Installation backup", inspection.backup_path.unwrap_or_default(), "A managed backup record is readable", "No action required") }
                else { item("BACKUP_READABLE", CheckStatus::Warn, "Installation backup", "No readable managed backup", "A clean install may not have an older baseline", "Export diagnostics before replacing an unknown or mixed installation") });
        }
        Err(error) => checks.push(item("INSTALL_RECORD", CheckStatus::Fail, "Installation record", error.detail, "Managed installation metadata cannot be inspected", "Export diagnostics, then repair installation")),
    }

    for (code, name, relative) in [
        ("METAMOD_X64", "MetaMod", "addons/metamod/bin/win64/server.dll"),
        ("CSS_X64", "CounterStrikeSharp", "addons/counterstrikesharp/bin/win64/counterstrikesharp.dll"),
        ("CSS_DOTNET_X64", "CounterStrikeSharp .NET runtime", "addons/counterstrikesharp/dotnet/dotnet.exe"),
        ("RAYTRACE_X64", "RayTrace", "addons/RayTrace/bin/win64/RayTrace.dll"),
        ("BOTHIDER_X64", "BotHider", "addons/BotHider/bin/win64/BotHider.dll"),
        ("MATCH_COORDINATOR_X64", "PlusMatchCoordinator", "addons/counterstrikesharp/plugins/PlusMatchCoordinator/PlusMatchCoordinator.dll"),
    ] { checks.push(component_check(code, name, target.join(relative))); }
    checks.push(file_check("MATCH_CATALOG", "Match catalog", &target.join("addons/counterstrikesharp/plugins/PlusMatchCoordinator/match_catalog.json"), "Repair installation to restore the versioned catalog"));
    checks.push(file_check("MATCH_CORE", "MatchCore", &target.join("addons/counterstrikesharp/plugins/PlusMatchCoordinator/MatchCore.dll"), "Repair installation to restore the match rules and statistics core"));
    checks.push(file_check("RATING_MODEL", "Rating Plus model", &target.join("addons/counterstrikesharp/plugins/PlusMatchCoordinator/rating-plus-3.0-proxy-v1.json"), "Repair installation to restore the offline model"));
    for difficulty in ["Low", "Medium", "High"] {
        checks.push(file_check(
            &format!("MATCH_PROFILE_{}", difficulty.to_ascii_uppercase()),
            &format!("{difficulty} match Bot profiles"),
            &target.join("addons/counterstrikesharp/plugins/PlusMatchCoordinator/profiles").join(difficulty).join("botprofile.db"),
            "Repair installation to restore the versioned match profiles",
        ));
    }

    let pass_count = checks.iter().filter(|check| check.status == CheckStatus::Pass).count();
    let warn_count = checks.iter().filter(|check| check.status == CheckStatus::Warn).count();
    let fail_count = checks.iter().filter(|check| check.status == CheckStatus::Fail).count();
    let overall = if fail_count > 0 { CheckStatus::Fail } else if warn_count > 0 { CheckStatus::Warn } else { CheckStatus::Pass };
    Ok(InstallCheckReport { schema_version: 1, generated_at_unix: SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs(), target: target.to_string_lossy().into_owned(), overall, pass_count, warn_count, fail_count, checks })
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
