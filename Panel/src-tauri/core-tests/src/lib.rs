#![allow(dead_code)]

use serde::Serialize;

type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, Serialize)]
struct AppError {
    code: &'static str,
    category: &'static str,
    detail: String,
}

impl AppError {
    fn new(code: &'static str, category: &'static str, detail: impl Into<String>) -> Self {
        Self { code, category, detail: detail.into() }
    }
    fn invalid(detail: impl Into<String>) -> Self { Self::new("E1002", "validation", detail) }
    fn payload(detail: impl Into<String>) -> Self { Self::new("E1301", "payload", detail) }
    fn transaction(detail: impl Into<String>) -> Self { Self::new("E1401", "installation", detail) }
    fn transaction_io(error: std::io::Error) -> Self { Self::transaction(error.to_string()) }
}

#[path = "../../src/app_storage.rs"]
mod app_storage;
#[path = "../../src/atomic_fs.rs"]
mod atomic_fs;
#[path = "../../src/diagnostics.rs"]
mod diagnostics;
#[path = "../../src/installer.rs"]
mod installer;
#[path = "../../src/logging.rs"]
mod logging;
#[path = "../../src/mode_files.rs"]
mod mode_files;
#[path = "../../src/runtime_state.rs"]
mod runtime_state;
#[path = "../../src/steam.rs"]
mod steam;
