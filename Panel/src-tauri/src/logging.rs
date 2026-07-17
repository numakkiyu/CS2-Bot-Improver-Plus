use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_ACTIVE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILES: usize = 20;
const RETENTION: Duration = Duration::from_secs(14 * 24 * 60 * 60);
static LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
struct LogEntry<'a> {
    timestamp_unix_ms: u128,
    level: &'a str,
    event: &'a str,
    detail: &'a str,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn log_dir(root: &Path) -> PathBuf {
    root.join("logs").join("panel")
}

fn active_log(root: &Path) -> PathBuf {
    log_dir(root).join("panel-current.jsonl")
}

fn rotate_if_needed(root: &Path) -> std::io::Result<bool> {
    let active = active_log(root);
    if fs::metadata(&active)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        < MAX_ACTIVE_BYTES
    {
        return Ok(false);
    }
    let rotated = log_dir(root).join(format!("panel-{}.jsonl", now_ms()));
    fs::rename(active, rotated)?;
    Ok(true)
}

pub fn append(root: &Path, level: &str, event: &str, detail: &str) {
    let Ok(_guard) = LOG_LOCK.lock() else {
        return;
    };
    let directory = log_dir(root);
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let Ok(rotated) = rotate_if_needed(root) else {
        return;
    };
    let entry = LogEntry {
        timestamp_unix_ms: now_ms(),
        level,
        event,
        detail,
    };
    let Ok(mut line) = serde_json::to_vec(&entry) else {
        return;
    };
    line.push(b'\n');
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(active_log(root))
    {
        let _ = file.write_all(&line);
    }
    if rotated {
        let _ = cleanup_unlocked(root);
    }
}

pub fn cleanup(root: &Path) -> std::io::Result<usize> {
    let _guard = LOG_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("log lock poisoned"))?;
    cleanup_unlocked(root)
}

fn cleanup_unlocked(root: &Path) -> std::io::Result<usize> {
    let directory = log_dir(root);
    fs::create_dir_all(&directory)?;
    let now = SystemTime::now();
    let active = active_log(root);
    let active_size = fs::metadata(&active)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let active_files = usize::from(active.is_file());
    let mut removed = 0;
    let mut files = Vec::new();
    for entry in fs::read_dir(&directory)?.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() || path == active {
            continue;
        }
        let modified = metadata.modified().unwrap_or(UNIX_EPOCH);
        if now.duration_since(modified).unwrap_or_default() > RETENTION {
            if fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        } else {
            files.push((modified, metadata.len(), path));
        }
    }
    files.sort_by_key(|(modified, _, _)| *modified);
    let mut total: u64 = active_size.saturating_add(files.iter().map(|(_, size, _)| *size).sum());
    let max_rotated_files = MAX_FILES.saturating_sub(active_files);
    while files.len() > max_rotated_files || total > MAX_TOTAL_BYTES {
        let (_, size, path) = files.remove(0);
        if fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logger_writes_jsonl_and_keeps_active_log() {
        let root = std::env::temp_dir().join(format!("cs2bi-log-{}", now_ms()));
        append(&root, "INFO", "test", "hello");
        let content = fs::read_to_string(active_log(&root)).unwrap();
        assert!(content.contains("\"event\":\"test\""));
        cleanup(&root).unwrap();
        assert!(active_log(&root).is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn garbage_collection_caps_rotated_log_count() {
        let root = std::env::temp_dir().join(format!("cs2bi-log-gc-{}", now_ms()));
        let directory = log_dir(&root);
        fs::create_dir_all(&directory).unwrap();
        for index in 0..25 {
            fs::write(directory.join(format!("panel-{index:02}.jsonl")), b"old").unwrap();
        }
        let removed = cleanup(&root).unwrap();
        assert_eq!(removed, 5);
        assert_eq!(recent_count(&directory), 20);
        fs::remove_dir_all(root).unwrap();

        fn recent_count(directory: &Path) -> usize {
            fs::read_dir(directory)
                .unwrap()
                .flatten()
                .filter(|entry| entry.path().is_file())
                .count()
        }
    }

    #[test]
    fn garbage_collection_counts_the_active_log_toward_the_limit() {
        let root = std::env::temp_dir().join(format!("cs2bi-log-active-gc-{}", now_ms()));
        let directory = log_dir(&root);
        fs::create_dir_all(&directory).unwrap();
        fs::write(active_log(&root), b"active").unwrap();
        for index in 0..20 {
            fs::write(directory.join(format!("panel-{index:02}.jsonl")), b"old").unwrap();
        }
        assert_eq!(cleanup(&root).unwrap(), 1);
        assert_eq!(
            fs::read_dir(&directory).unwrap().flatten().count(),
            MAX_FILES
        );
        assert!(active_log(&root).is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
