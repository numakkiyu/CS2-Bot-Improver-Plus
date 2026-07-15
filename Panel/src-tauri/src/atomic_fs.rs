use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub fn temporary_path(destination: &Path) -> io::Result<PathBuf> {
    let file_name = destination.file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "destination has no file name"))?
        .to_string_lossy();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(destination.with_file_name(format!(
        ".{file_name}.cs2bi-{}-{sequence}.tmp",
        std::process::id()
    )))
}

pub fn write_replace(destination: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = destination.parent() { fs::create_dir_all(parent)?; }
    let temporary = temporary_path(destination)?;
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        replace(&temporary, destination)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

pub fn sync(path: &Path) -> io::Result<()> {
    OpenOptions::new().write(true).open(path)?.sync_all()
}

#[cfg(windows)]
pub fn replace(temporary: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };

    let source = temporary.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let target = destination.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)
    };
    if result == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
pub fn replace(temporary: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_never_exposes_a_missing_destination() {
        let root = std::env::temp_dir().join(format!("cs2bi-atomic-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("state.json");
        write_replace(&destination, b"old").unwrap();
        write_replace(&destination, b"new").unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert_eq!(fs::read_dir(&root).unwrap().flatten().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
