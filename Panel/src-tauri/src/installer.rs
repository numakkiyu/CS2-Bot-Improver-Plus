use crate::{AppError, Result, atomic_fs};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MANIFEST_FILE: &str = "plus-payload-manifest.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PayloadManifest {
    pub schema_version: u32,
    pub package_version: String,
    pub entries: Vec<PayloadEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PayloadEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub component: String,
    pub ownership: String,
    pub restore_policy: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct InstallRecordEntry {
    path: String,
    original_existed: bool,
    original_sha256: Option<String>,
    original_backup: Option<String>,
    installed_sha256: String,
    ownership: String,
    restore_policy: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct InstallRecord {
    schema_version: u32,
    installation_id: String,
    target: String,
    package_version: String,
    installed_at: u64,
    entries: Vec<InstallRecordEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct TransactionChange {
    path: String,
    existed: bool,
    backup: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct TransactionJournal {
    schema_version: u32,
    operation: String,
    target: String,
    transaction_dir: String,
    changes: Vec<TransactionChange>,
    #[serde(default)]
    committed: bool,
    #[serde(default)]
    previous_record: Option<InstallRecord>,
}

#[derive(Clone, Debug, Serialize)]
pub struct InstallationInspection {
    pub installed: bool,
    pub package_version: Option<String>,
    pub manifest_available: bool,
    pub total: usize,
    pub healthy: usize,
    pub missing: Vec<String>,
    pub corrupt: Vec<String>,
    pub restore_available: bool,
    pub backup_path: Option<String>,
    pub interrupted_transaction: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct InstallPlan {
    pub package_version: String,
    pub target: String,
    pub total_files: usize,
    pub new_files: usize,
    pub overwritten_files: usize,
    pub backup_path: String,
    pub required_target_bytes: u64,
    pub available_target_bytes: u64,
    pub required_backup_bytes: u64,
    pub available_backup_bytes: u64,
    pub writable: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct InstallTransactionResult {
    pub package_version: String,
    pub installed_files: usize,
    pub backup_path: String,
    pub repaired: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct RestoreResult {
    pub restored_files: usize,
    pub removed_files: usize,
    pub preserved_files: usize,
    pub presets_backup: Option<String>,
    pub steam_verify_uri: String,
}

fn unix_time() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|error| AppError::payload(error.to_string()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| AppError::payload(error.to_string()))?;
        if read == 0 { break; }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn safe_relative(raw: &str) -> Result<PathBuf> {
    let path = PathBuf::from(raw.replace('/', "\\"));
    if path.as_os_str().is_empty() || path.components().any(|component| {
        matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_))
    }) {
        return Err(AppError::payload(format!("Unsafe payload path: {raw}")));
    }
    Ok(path)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| AppError::transaction(error.to_string()))?;
    atomic_fs::write_replace(path, &bytes).map_err(|error| AppError::transaction(format!(
        "Atomic JSON write failed ({}): {error}", path.display())))
}

fn copy_file(source: &Path, destination: &Path) -> Result<()> {
    if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(AppError::transaction_io)?; }
    fs::copy(source, destination).map_err(AppError::transaction_io)?;
    Ok(())
}

fn installation_id(target: &Path) -> String {
    let normalized = target.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    format!("{:x}", digest)[..16].to_string()
}

fn installation_dir(state_root: &Path, target: &Path) -> PathBuf {
    state_root.join("installations").join(installation_id(target))
}

fn read_manifest_document(payload_root: &Path) -> Result<PayloadManifest> {
    let path = payload_root.join(MANIFEST_FILE);
    let bytes = fs::read(&path).map_err(|_| AppError::payload(format!("Payload manifest not found: {}", path.display())))?;
    let manifest: PayloadManifest = serde_json::from_slice(&bytes)
        .map_err(|error| AppError::payload(format!("Invalid payload manifest: {error}")))?;
    if manifest.schema_version != 1 || manifest.entries.is_empty() {
        return Err(AppError::payload("Unsupported or empty payload manifest"));
    }
    for entry in &manifest.entries {
        safe_relative(&entry.path)?;
        if entry.sha256.len() != 64 || !entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(AppError::payload(format!("Invalid payload hash: {}", entry.path)));
        }
    }
    Ok(manifest)
}

fn read_manifest(payload_root: &Path) -> Result<PayloadManifest> {
    let manifest = read_manifest_document(payload_root)?;
    for entry in &manifest.entries {
        let relative = safe_relative(&entry.path)?;
        let source = payload_root.join(&relative);
        if !source.is_file() || fs::metadata(&source).map_err(AppError::transaction_io)?.len() != entry.size ||
            !sha256(&source)?.eq_ignore_ascii_case(&entry.sha256)
        {
            return Err(AppError::payload(format!("Payload verification failed: {}", entry.path)));
        }
    }
    Ok(manifest)
}

fn read_record(directory: &Path) -> Option<InstallRecord> {
    serde_json::from_slice(&fs::read(directory.join("record.json")).ok()?).ok()
}

pub fn inspect(payload_root: &Path, state_root: &Path, target: &Path) -> Result<InstallationInspection> {
    inspect_impl(payload_root, state_root, target, true)
}

pub fn inspect_quick(payload_root: &Path, state_root: &Path, target: &Path) -> Result<InstallationInspection> {
    inspect_impl(payload_root, state_root, target, false)
}

fn inspect_impl(payload_root: &Path, state_root: &Path, target: &Path, verify_hashes: bool) -> Result<InstallationInspection> {
    let directory = installation_dir(state_root, target);
    let record = read_record(&directory);
    let manifest = if verify_hashes { read_manifest(payload_root).ok() } else { read_manifest_document(payload_root).ok() };
    let entries: Vec<(String, String, Option<u64>)> = if let Some(manifest) = &manifest {
        manifest.entries.iter().map(|entry| (entry.path.clone(), entry.sha256.clone(), Some(entry.size))).collect()
    } else if let Some(record) = &record {
        record.entries.iter().map(|entry| (entry.path.clone(), entry.installed_sha256.clone(), None)).collect()
    } else { Vec::new() };

    let mut healthy = 0;
    let mut missing = Vec::new();
    let mut corrupt = Vec::new();
    for (raw, expected, expected_size) in &entries {
        let path = target.join(safe_relative(raw)?);
        if !path.is_file() { missing.push(raw.clone()); }
        else if verify_hashes {
            if sha256(&path)?.eq_ignore_ascii_case(expected) { healthy += 1; }
            else { corrupt.push(raw.clone()); }
        } else if expected_size.is_none_or(|size| fs::metadata(&path).map(|metadata| metadata.len() == size).unwrap_or(false)) {
            healthy += 1;
        } else { corrupt.push(raw.clone()); }
    }
    Ok(InstallationInspection {
        installed: record.is_some(),
        package_version: record.as_ref().map(|record| record.package_version.clone()),
        manifest_available: manifest.is_some(),
        total: entries.len(),
        healthy,
        missing,
        corrupt,
        restore_available: record.is_some(),
        backup_path: record.as_ref().map(|_| directory.to_string_lossy().into_owned()),
        interrupted_transaction: directory.join("journal.json").is_file(),
    })
}

struct Preflight {
    required_target_bytes: u64,
    available_target_bytes: u64,
    required_backup_bytes: u64,
    available_backup_bytes: u64,
}

fn preflight(manifest: &PayloadManifest, state_root: &Path, target: &Path) -> Result<Preflight> {
    if !target.is_dir() {
        return Err(AppError::transaction(format!("Installation target is not a directory: {}", target.display())));
    }
    fs::create_dir_all(state_root).map_err(AppError::transaction_io)?;
    let probe = target.join(format!(".cs2bi-write-test-{}", unix_time()));
    fs::write(&probe, b"write-test").map_err(|error| AppError::transaction(format!(
        "The CS2 directory is not writable ({}): {error}", target.display())))?;
    fs::remove_file(&probe).map_err(|error| AppError::transaction(format!(
        "The CS2 write test could not be cleaned up ({}): {error}", probe.display())))?;

    let mut largest_payload = 0;
    let mut backup_bytes: u64 = 0;
    for entry in &manifest.entries {
        largest_payload = largest_payload.max(entry.size);
        let relative = safe_relative(&entry.path)?;
        let mut cursor = target.to_path_buf();
        let components = relative.components().collect::<Vec<_>>();
        for component in components.iter().take(components.len().saturating_sub(1)) {
            cursor.push(component.as_os_str());
            if cursor.exists() && !cursor.is_dir() {
                return Err(AppError::transaction(format!(
                    "A payload parent path is not a directory: {}", cursor.display())));
            }
        }
        let destination = target.join(&relative);
        if destination.exists() && !destination.is_file() {
            return Err(AppError::transaction(format!(
                "A payload file target is occupied by a directory: {}", destination.display())));
        }
        if let Ok(metadata) = fs::metadata(destination) { backup_bytes = backup_bytes.saturating_add(metadata.len()); }
    }

    const MARGIN: u64 = 64 * 1024 * 1024;
    let required_target_bytes = largest_payload.saturating_add(MARGIN);
    let required_backup_bytes = backup_bytes.saturating_mul(2).saturating_add(MARGIN);
    let available_target_bytes = fs2::available_space(target).map_err(AppError::transaction_io)?;
    let available_backup_bytes = fs2::available_space(state_root).map_err(AppError::transaction_io)?;
    if available_target_bytes < required_target_bytes {
        return Err(AppError::transaction(format!(
            "Insufficient space in CS2 directory: need {required_target_bytes} bytes, available {available_target_bytes}")));
    }
    if available_backup_bytes < required_backup_bytes {
        return Err(AppError::transaction(format!(
            "Insufficient space for backups: need {required_backup_bytes} bytes, available {available_backup_bytes}")));
    }
    Ok(Preflight { required_target_bytes, available_target_bytes, required_backup_bytes, available_backup_bytes })
}

pub fn plan(payload_root: &Path, state_root: &Path, target: &Path) -> Result<InstallPlan> {
    let manifest = read_manifest(payload_root)?;
    let preflight = preflight(&manifest, state_root, target)?;
    let mut new_files = 0;
    let mut overwritten_files = 0;
    for entry in &manifest.entries {
        if target.join(safe_relative(&entry.path)?).exists() { overwritten_files += 1; }
        else { new_files += 1; }
    }
    Ok(InstallPlan {
        package_version: manifest.package_version,
        target: target.to_string_lossy().into_owned(),
        total_files: manifest.entries.len(),
        new_files,
        overwritten_files,
        backup_path: installation_dir(state_root, target).to_string_lossy().into_owned(),
        required_target_bytes: preflight.required_target_bytes,
        available_target_bytes: preflight.available_target_bytes,
        required_backup_bytes: preflight.required_backup_bytes,
        available_backup_bytes: preflight.available_backup_bytes,
        writable: true,
    })
}

fn rollback(directory: &Path, journal: &TransactionJournal) -> Result<()> {
    for change in journal.changes.iter().rev() {
        let target = PathBuf::from(&journal.target).join(safe_relative(&change.path)?);
        if change.existed {
            let backup = change.backup.as_ref().ok_or_else(|| AppError::transaction("Rollback backup is missing"))?;
            copy_file(&directory.join(backup), &target)?;
        } else if target.is_file() {
            fs::remove_file(&target).map_err(AppError::transaction_io)?;
        }
    }
    Ok(())
}

fn restore_previous_record(directory: &Path, previous: &Option<InstallRecord>) -> Result<()> {
    let record_path = directory.join("record.json");
    if let Some(record) = previous {
        write_json_atomic(&record_path, record)
    } else if record_path.is_file() {
        fs::remove_file(record_path).map_err(AppError::transaction_io)
    } else { Ok(()) }
}

pub fn recover_incomplete(state_root: &Path, target: &Path) -> Result<bool> {
    let directory = installation_dir(state_root, target);
    let journal_path = directory.join("journal.json");
    if !journal_path.is_file() { return Ok(false); }
    let journal: TransactionJournal = serde_json::from_slice(&fs::read(&journal_path).map_err(AppError::transaction_io)?)
        .map_err(|error| AppError::transaction(error.to_string()))?;
    if !journal.committed {
        rollback(&directory, &journal)?;
        restore_previous_record(&directory, &journal.previous_record)?;
    }
    let _ = fs::remove_dir_all(directory.join(&journal.transaction_dir));
    fs::remove_file(journal_path).map_err(AppError::transaction_io)?;
    Ok(true)
}

pub fn install(payload_root: &Path, state_root: &Path, target: &Path, repaired: bool) -> Result<InstallTransactionResult> {
    recover_incomplete(state_root, target)?;
    let manifest = read_manifest(payload_root)?;
    preflight(&manifest, state_root, target)?;
    let directory = installation_dir(state_root, target);
    fs::create_dir_all(&directory).map_err(AppError::transaction_io)?;
    let old_record = read_record(&directory);
    let old_entries: BTreeMap<String, InstallRecordEntry> = old_record.as_ref()
        .map(|record| record.entries.iter().cloned().map(|entry| (entry.path.clone(), entry)).collect())
        .unwrap_or_default();
    let transaction_name = format!("transaction-{}", unix_time());
    let mut journal = TransactionJournal {
        schema_version: 1,
        operation: if repaired { "repair" } else { "install" }.to_string(),
        target: target.to_string_lossy().into_owned(),
        transaction_dir: transaction_name.clone(),
        changes: Vec::new(),
        committed: false,
        previous_record: old_record.clone(),
    };
    let journal_path = directory.join("journal.json");
    write_json_atomic(&journal_path, &journal)?;
    let transaction_root = directory.join(&transaction_name);
    let original_root = directory.join("original");
    let mut record_entries = old_entries.clone();
    let mut installed_files = 0;

    let outcome = (|| -> Result<()> {
        for entry in &manifest.entries {
            let relative = safe_relative(&entry.path)?;
            let source = payload_root.join(&relative);
            let destination = target.join(&relative);
            if repaired && old_entries.contains_key(&entry.path) && destination.is_file() &&
                sha256(&destination)?.eq_ignore_ascii_case(&entry.sha256)
            {
                continue;
            }
            let transaction_backup = transaction_root.join(&relative);
            let existed = destination.is_file();
            if existed { copy_file(&destination, &transaction_backup)?; }
            journal.changes.push(TransactionChange {
                path: entry.path.clone(),
                existed,
                backup: existed.then(|| format!("{transaction_name}/{}", entry.path.replace('\\', "/"))),
            });
            write_json_atomic(&journal_path, &journal)?;

            let baseline = if let Some(previous) = old_entries.get(&entry.path) {
                previous.clone()
            } else if existed {
                let original = original_root.join(&relative);
                copy_file(&destination, &original)?;
                InstallRecordEntry {
                    path: entry.path.clone(),
                    original_existed: true,
                    original_sha256: Some(sha256(&destination)?),
                    original_backup: Some(format!("original/{}", entry.path.replace('\\', "/"))),
                    installed_sha256: entry.sha256.clone(),
                    ownership: entry.ownership.clone(),
                    restore_policy: entry.restore_policy.clone(),
                }
            } else {
                InstallRecordEntry {
                    path: entry.path.clone(),
                    original_existed: false,
                    original_sha256: None,
                    original_backup: None,
                    installed_sha256: entry.sha256.clone(),
                    ownership: entry.ownership.clone(),
                    restore_policy: entry.restore_policy.clone(),
                }
            };

            let temporary = atomic_fs::temporary_path(&destination).map_err(AppError::transaction_io)?;
            let replacement = (|| -> Result<()> {
                copy_file(&source, &temporary)?;
                if !sha256(&temporary)?.eq_ignore_ascii_case(&entry.sha256) {
                    return Err(AppError::payload(format!("Copied payload hash mismatch: {}", entry.path)));
                }
                atomic_fs::sync(&temporary).map_err(AppError::transaction_io)?;
                atomic_fs::replace(&temporary, &destination).map_err(|error| AppError::transaction(format!(
                    "Atomic payload replace failed ({} -> {}): {error}",
                    temporary.display(), destination.display())))
            })();
            if replacement.is_err() { let _ = fs::remove_file(&temporary); }
            replacement?;

            record_entries.insert(entry.path.clone(), InstallRecordEntry {
                installed_sha256: entry.sha256.clone(),
                ownership: entry.ownership.clone(),
                restore_policy: entry.restore_policy.clone(),
                ..baseline
            });
            installed_files += 1;
        }
        Ok(())
    })();

    if let Err(error) = outcome {
        let rollback_error = rollback(&directory, &journal).err();
        let record_error = restore_previous_record(&directory, &journal.previous_record).err();
        let _ = fs::remove_dir_all(&transaction_root);
        let _ = fs::remove_file(&journal_path);
        return Err(rollback_error.or(record_error).unwrap_or(error));
    }

    let record = InstallRecord {
        schema_version: 1,
        installation_id: installation_id(target),
        target: target.to_string_lossy().into_owned(),
        package_version: manifest.package_version.clone(),
        installed_at: unix_time(),
        entries: record_entries.into_values().collect(),
    };
    write_json_atomic(&directory.join("record.json"), &record)?;
    journal.committed = true;
    write_json_atomic(&journal_path, &journal)?;
    let _ = fs::remove_dir_all(transaction_root);
    fs::remove_file(journal_path).map_err(AppError::transaction_io)?;
    Ok(InstallTransactionResult {
        package_version: manifest.package_version,
        installed_files,
        backup_path: directory.to_string_lossy().into_owned(),
        repaired,
    })
}

fn preserve_cosmetics(state_root: &Path, target: &Path, timestamp: u64) -> Result<Option<PathBuf>> {
    let source = target.join("addons/counterstrikesharp/plugins/PlayerKnifeCustomizer");
    let files = ["player_knife_presets.json", "player_gun_presets.json"];
    if !files.iter().any(|name| source.join(name).is_file()) { return Ok(None); }
    let destination = state_root.join("presets").join(timestamp.to_string());
    for name in files {
        if source.join(name).is_file() { copy_file(&source.join(name), &destination.join(name))?; }
    }
    Ok(Some(destination))
}

pub fn restore(payload_root: &Path, state_root: &Path, target: &Path) -> Result<RestoreResult> {
    recover_incomplete(state_root, target)?;
    let timestamp = unix_time();
    let presets = preserve_cosmetics(state_root, target, timestamp)?;
    let directory = installation_dir(state_root, target);
    fs::create_dir_all(&directory).map_err(AppError::transaction_io)?;
    let previous_record = read_record(&directory);
    let transaction_name = format!("transaction-restore-{timestamp}");
    let transaction_root = directory.join(&transaction_name);
    let journal_path = directory.join("journal.json");
    let mut journal = TransactionJournal {
        schema_version: 1,
        operation: "restore".to_string(),
        target: target.to_string_lossy().into_owned(),
        transaction_dir: transaction_name.clone(),
        changes: Vec::new(),
        committed: false,
        previous_record: previous_record.clone(),
    };
    write_json_atomic(&journal_path, &journal)?;
    let mut restored_files = 0;
    let mut removed_files = 0;
    let mut preserved_files = 0;

    let mut stage = |relative: &Path, raw: &str, destination: &Path| -> Result<()> {
        let existed = destination.is_file();
        let backup = transaction_root.join(relative);
        if existed { copy_file(destination, &backup)?; }
        journal.changes.push(TransactionChange {
            path: raw.to_string(),
            existed,
            backup: existed.then(|| format!("{transaction_name}/{}", raw.replace('\\', "/"))),
        });
        write_json_atomic(&journal_path, &journal)
    };

    let outcome = (|| -> Result<()> {
    if let Some(record) = &previous_record {
        for entry in record.entries.iter().rev() {
            let relative = safe_relative(&entry.path)?;
            let destination = target.join(&relative);
            if entry.original_existed {
                stage(&relative, &entry.path, &destination)?;
                let backup = entry.original_backup.as_ref()
                    .ok_or_else(|| AppError::transaction(format!("Original backup missing from record: {}", entry.path)))?;
                copy_file(&directory.join(backup), &destination)?;
                restored_files += 1;
            } else if destination.is_file() {
                stage(&relative, &entry.path, &destination)?;
                if !sha256(&destination)?.eq_ignore_ascii_case(&entry.installed_sha256) {
                    let preserved = directory.join("preserved-modified").join(timestamp.to_string()).join(&relative);
                    copy_file(&destination, &preserved)?;
                    preserved_files += 1;
                }
                fs::remove_file(destination).map_err(AppError::transaction_io)?;
                removed_files += 1;
            }
        }
        fs::remove_file(directory.join("record.json")).map_err(AppError::transaction_io)?;
    } else {
        let manifest = read_manifest(payload_root)?;
        for entry in manifest.entries.iter().filter(|entry| entry.ownership == "plus") {
            let destination = target.join(safe_relative(&entry.path)?);
            if destination.is_file() && sha256(&destination)?.eq_ignore_ascii_case(&entry.sha256) {
                let relative = safe_relative(&entry.path)?;
                stage(&relative, &entry.path, &destination)?;
                fs::remove_file(destination).map_err(AppError::transaction_io)?;
                removed_files += 1;
            }
        }
    }
    Ok(())
    })();
    drop(stage);

    if let Err(error) = outcome {
        let rollback_error = rollback(&directory, &journal).err();
        let record_error = restore_previous_record(&directory, &journal.previous_record).err();
        let _ = fs::remove_dir_all(&transaction_root);
        let _ = fs::remove_file(&journal_path);
        return Err(rollback_error.or(record_error).unwrap_or(error));
    }

    journal.committed = true;
    write_json_atomic(&journal_path, &journal)?;
    let _ = fs::remove_dir_all(&transaction_root);
    fs::remove_file(&journal_path).map_err(AppError::transaction_io)?;

    Ok(RestoreResult {
        restored_files,
        removed_files,
        preserved_files,
        presets_backup: presets.map(|path| path.to_string_lossy().into_owned()),
        steam_verify_uri: "steam://validate/730".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("cs2bi-installer-{name}-{}", unix_time()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn fixture(payload: &Path, target: &Path) {
        fs::create_dir_all(payload.join("cfg")).unwrap();
        fs::create_dir_all(target.join("cfg")).unwrap();
        fs::write(payload.join("cfg/test.cfg"), b"plus").unwrap();
        fs::write(target.join("cfg/test.cfg"), b"steam").unwrap();
        fs::write(target.join("cfg/foreign.cfg"), b"foreign").unwrap();
        let hash = sha256(&payload.join("cfg/test.cfg")).unwrap();
        write_json_atomic(&payload.join(MANIFEST_FILE), &PayloadManifest {
            schema_version: 1,
            package_version: "1.4.2.2".to_string(),
            entries: vec![PayloadEntry {
                path: "cfg/test.cfg".to_string(), size: 4, sha256: hash,
                component: "config".to_string(), ownership: "plus".to_string(),
                restore_policy: "restore".to_string(),
            }],
        }).unwrap();
    }

    #[test]
    fn install_repair_and_restore_preserve_originals_and_foreign_files() {
        let base = root("roundtrip");
        let payload = base.join("payload");
        let target = base.join("target");
        let state = base.join("state");
        fixture(&payload, &target);

        install(&payload, &state, &target, false).unwrap();
        assert_eq!(fs::read(target.join("cfg/test.cfg")).unwrap(), b"plus");
        fs::write(target.join("cfg/test.cfg"), b"broken").unwrap();
        assert_eq!(inspect(&payload, &state, &target).unwrap().corrupt.len(), 1);
        let repaired = install(&payload, &state, &target, true).unwrap();
        assert_eq!(repaired.installed_files, 1);
        let unchanged = install(&payload, &state, &target, true).unwrap();
        assert_eq!(unchanged.installed_files, 0);
        restore(&payload, &state, &target).unwrap();
        assert_eq!(fs::read(target.join("cfg/test.cfg")).unwrap(), b"steam");
        assert_eq!(fs::read(target.join("cfg/foreign.cfg")).unwrap(), b"foreign");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    #[ignore = "requires CS2BI_REAL_PAYLOAD to point at a packaged payload"]
    fn packaged_payload_install_repair_restore_roundtrip() {
        let payload = PathBuf::from(std::env::var("CS2BI_REAL_PAYLOAD")
            .expect("CS2BI_REAL_PAYLOAD is required"));
        let manifest = read_manifest(&payload).unwrap();
        let base = root("packaged-roundtrip");
        let target = base.join("target");
        let state = base.join("state");
        fs::create_dir_all(&target).unwrap();

        let original = manifest.entries.iter()
            .find(|entry| !entry.path.ends_with("player_knife_presets.json") &&
                !entry.path.ends_with("player_gun_presets.json"))
            .expect("payload needs a restorable file");
        let original_path = target.join(safe_relative(&original.path).unwrap());
        fs::create_dir_all(original_path.parent().unwrap()).unwrap();
        fs::write(&original_path, b"steam-original").unwrap();
        let foreign = target.join("addons/third-party/keep.txt");
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        fs::write(&foreign, b"foreign").unwrap();

        let planned = plan(&payload, &state, &target).unwrap();
        assert_eq!(planned.total_files, manifest.entries.len());
        assert_eq!(planned.overwritten_files, 1);
        install(&payload, &state, &target, false).unwrap();
        let installed = inspect(&payload, &state, &target).unwrap();
        assert_eq!(installed.healthy, installed.total);

        let damaged = manifest.entries.iter().find(|entry| entry.path != original.path)
            .expect("payload needs at least two files");
        fs::write(target.join(safe_relative(&damaged.path).unwrap()), b"damaged").unwrap();
        assert_eq!(inspect(&payload, &state, &target).unwrap().corrupt.len(), 1);
        assert_eq!(install(&payload, &state, &target, true).unwrap().installed_files, 1);

        let knife = manifest.entries.iter()
            .find(|entry| entry.path.ends_with("player_knife_presets.json"))
            .expect("packaged cosmetics preset is missing");
        let knife_path = target.join(safe_relative(&knife.path).unwrap());
        fs::write(&knife_path, b"player-modified-preset").unwrap();
        let restored = restore(&payload, &state, &target).unwrap();
        assert_eq!(fs::read(&original_path).unwrap(), b"steam-original");
        assert_eq!(fs::read(&foreign).unwrap(), b"foreign");
        assert!(!knife_path.exists());
        let preset_backup = PathBuf::from(restored.presets_backup.expect("preset backup is required"));
        assert_eq!(fs::read(preset_backup.join("player_knife_presets.json")).unwrap(), b"player-modified-preset");
        assert!(!inspect(&payload, &state, &target).unwrap().installed);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_parent_directory_payload_paths() {
        assert!(safe_relative("../gameinfo.gi").is_err());
        assert!(safe_relative(r"C:\\game\\csgo").is_err());
    }

    #[test]
    fn interrupted_transaction_restores_files_and_previous_record_state() {
        let base = root("interrupted");
        let payload = base.join("payload");
        let target = base.join("target");
        let state = base.join("state");
        fixture(&payload, &target);
        let directory = installation_dir(&state, &target);
        let transaction = directory.join("transaction-test");
        fs::create_dir_all(transaction.join("cfg")).unwrap();
        fs::copy(target.join("cfg/test.cfg"), transaction.join("cfg/test.cfg")).unwrap();
        fs::write(target.join("cfg/test.cfg"), b"partial").unwrap();
        fs::create_dir_all(&directory).unwrap();
        write_json_atomic(&directory.join("journal.json"), &TransactionJournal {
            schema_version: 1,
            operation: "install".to_string(),
            target: target.to_string_lossy().into_owned(),
            transaction_dir: "transaction-test".to_string(),
            changes: vec![TransactionChange {
                path: "cfg/test.cfg".to_string(),
                existed: true,
                backup: Some("transaction-test/cfg/test.cfg".to_string()),
            }],
            committed: false,
            previous_record: None,
        }).unwrap();

        assert!(recover_incomplete(&state, &target).unwrap());
        assert_eq!(fs::read(target.join("cfg/test.cfg")).unwrap(), b"steam");
        assert!(!directory.join("record.json").exists());
        assert!(!directory.join("journal.json").exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn failed_restore_rolls_back_to_installed_state_and_record() {
        let base = root("restore-rollback");
        let payload = base.join("payload");
        let target = base.join("target");
        let state = base.join("state");
        fixture(&payload, &target);
        install(&payload, &state, &target, false).unwrap();
        let directory = installation_dir(&state, &target);
        fs::remove_file(directory.join("original/cfg/test.cfg")).unwrap();

        assert!(restore(&payload, &state, &target).is_err());
        assert_eq!(fs::read(target.join("cfg/test.cfg")).unwrap(), b"plus");
        assert!(directory.join("record.json").is_file());
        assert!(!directory.join("journal.json").exists());
        fs::remove_dir_all(base).unwrap();
    }
}
