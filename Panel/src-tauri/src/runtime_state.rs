use serde::Serialize;
use std::path::{Path, PathBuf};
use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Clone, Debug, Default, Serialize)]
pub struct Cs2ProcessInfo {
    pub running: bool,
    pub pid: Option<u32>,
    pub executable: Option<String>,
    pub path_accessible: bool,
    pub matches_selected: bool,
}

fn install_root(csgo: &Path) -> Option<PathBuf> {
    let game = csgo.parent()?;
    game.parent().map(Path::to_path_buf)
}

fn path_matches(executable: &Path, csgo: &Path) -> bool {
    let Some(root) = install_root(csgo) else {
        return false;
    };
    executable
        .to_string_lossy()
        .to_ascii_lowercase()
        .starts_with(&root.to_string_lossy().to_ascii_lowercase())
}

pub fn inspect_cs2_process(selected: Option<&Path>) -> Cs2ProcessInfo {
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut fallback: Option<(Pid, Option<&Path>)> = None;
    for (pid, process) in system.processes() {
        if !process.name().eq_ignore_ascii_case("cs2.exe") {
            continue;
        }
        let executable = process.exe();
        if selected.is_some_and(|csgo| executable.is_some_and(|exe| path_matches(exe, csgo))) {
            return Cs2ProcessInfo {
                running: true,
                pid: Some(pid.as_u32()),
                executable: executable.map(|path| path.to_string_lossy().into_owned()),
                path_accessible: executable.is_some(),
                matches_selected: true,
            };
        }
        fallback.get_or_insert((*pid, executable));
    }

    let Some((pid, executable)) = fallback else {
        return Cs2ProcessInfo::default();
    };
    Cs2ProcessInfo {
        running: true,
        pid: Some(pid.as_u32()),
        executable: executable.map(|path| path.to_string_lossy().into_owned()),
        path_accessible: executable.is_some(),
        matches_selected: false,
    }
}

pub fn blocks_target_write(process: &Cs2ProcessInfo) -> bool {
    process.running && (process.matches_selected || !process.path_accessible)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_process_to_selected_installation() {
        let csgo = Path::new(
            r"F:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\csgo",
        );
        assert!(path_matches(
            Path::new(
                r"F:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
            ),
            csgo
        ));
        assert!(!path_matches(
            Path::new(
                r"D:\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe"
            ),
            csgo
        ));
    }

    #[test]
    fn inaccessible_running_process_blocks_mutation() {
        let process = Cs2ProcessInfo {
            running: true,
            path_accessible: false,
            ..Default::default()
        };
        assert!(blocks_target_write(&process));
    }
}
