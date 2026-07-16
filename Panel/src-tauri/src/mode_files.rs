use std::fs;
use std::path::Path;

pub(crate) type ModeResult<T> = std::result::Result<T, String>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LaunchMode {
    Online,
    Preview,
    Bots,
}

impl LaunchMode {
    pub(crate) fn parse(value: Option<&str>) -> ModeResult<Self> {
        match value {
            Some("online") => Ok(Self::Online),
            Some("preview") => Ok(Self::Preview),
            Some("bots") => Ok(Self::Bots),
            _ => Err("Select a valid game mode before launching CS2".into()),
        }
    }

    pub(crate) fn insecure(self) -> bool {
        self != Self::Online
    }
}

pub(crate) fn contains_metamod_search_path(bytes: &[u8]) -> bool {
    String::from_utf8_lossy(bytes)
        .to_ascii_lowercase()
        .contains("csgo/addons/metamod")
}

fn game_path_value(line: &str) -> Option<&str> {
    let content = line.split_once("//").map_or(line, |(content, _)| content);
    let mut fields = content.split_whitespace();
    if !fields.next()?.eq_ignore_ascii_case("game") {
        return None;
    }
    let value = fields.next()?;
    if fields.next().is_some() {
        return None;
    }
    Some(value)
}

fn rewrite_gameinfo(bytes: &[u8], include_metamod: bool) -> ModeResult<Vec<u8>> {
    let text = std::str::from_utf8(bytes)
        .map_err(|error| format!("gameinfo.gi is not valid UTF-8: {error}"))?;
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let trailing_newline = text.ends_with('\n');
    let mut output = Vec::new();
    let mut inserted = false;

    for line in text.lines() {
        if game_path_value(line)
            .is_some_and(|value| value.eq_ignore_ascii_case("csgo/addons/metamod"))
        {
            continue;
        }
        if include_metamod
            && !inserted
            && game_path_value(line).is_some_and(|value| value.eq_ignore_ascii_case("csgo"))
        {
            let indent: String = line.chars().take_while(|ch| ch.is_whitespace()).collect();
            output.push(format!("{indent}Game\tcsgo/addons/metamod"));
            inserted = true;
        }
        output.push(line.to_string());
    }

    if include_metamod && !inserted {
        return Err("gameinfo.gi has no primary 'Game csgo' SearchPath".into());
    }

    let mut rewritten = output.join(newline);
    if trailing_newline {
        rewritten.push_str(newline);
    }
    Ok(rewritten.into_bytes())
}

pub(crate) fn apply_launch_mode(root: &Path, mode: LaunchMode) -> ModeResult<()> {
    let destination = root.join("gameinfo.gi");
    if !destination.is_file() {
        return Err(format!(
            "Current CS2 gameinfo.gi is missing: {}",
            destination.display()
        ));
    }

    let active = fs::read(&destination).map_err(|error| error.to_string())?;
    let online = rewrite_gameinfo(&active, false)?;
    let bots = rewrite_gameinfo(&online, true)?;
    let online_backup = root.join("backup/Online/gameinfo.gi");
    let bots_backup = root.join("backup/WithBots/gameinfo.gi");
    if let Some(parent) = online_backup.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if let Some(parent) = bots_backup.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&online_backup, &online).map_err(|error| error.to_string())?;
    fs::write(&bots_backup, &bots).map_err(|error| error.to_string())?;

    let expected = if mode == LaunchMode::Online {
        &online
    } else {
        &bots
    };
    fs::write(&destination, expected).map_err(|error| error.to_string())?;
    if fs::read(&destination).map_err(|error| error.to_string())? != *expected {
        return Err(format!(
            "Mode verification failed after writing {}",
            destination.display()
        ));
    }

    let installed = fs::read(&destination).map_err(|error| error.to_string())?;
    if mode == LaunchMode::Online && contains_metamod_search_path(&installed) {
        return Err(
            "Normal matchmaking was blocked because active gameinfo.gi still loads Metamod"
                .into(),
        );
    }
    if mode != LaunchMode::Online && !contains_metamod_search_path(&installed) {
        return Err(
            "Enhanced bots were not enabled because active gameinfo.gi does not load Metamod"
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "cs2bi-plus-mode-files-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn launch_modes_refresh_stale_backups_from_the_current_gameinfo() {
        let root = test_root();
        fs::create_dir_all(root.join("backup/Online")).unwrap();
        fs::create_dir_all(root.join("backup/WithBots")).unwrap();
        let current = b"SearchPaths\r\n{\r\n\tGame\tcsgo\r\n}\r\nNewDepotSetting\t1\r\n";
        let stale_online = b"SearchPaths\r\n{\r\n\tGame\tcsgo\r\n}\r\n";
        let stale_bots = b"SearchPaths\r\n{\r\n\tGame\tcsgo/addons/metamod\r\n\tGame\tcsgo\r\n}\r\n";
        fs::write(root.join("gameinfo.gi"), current).unwrap();
        fs::write(root.join("backup/Online/gameinfo.gi"), stale_online).unwrap();
        fs::write(root.join("backup/WithBots/gameinfo.gi"), stale_bots).unwrap();

        apply_launch_mode(&root, LaunchMode::Bots).unwrap();
        let bots = fs::read_to_string(root.join("gameinfo.gi")).unwrap();
        assert!(bots.contains("NewDepotSetting"));
        assert!(bots.to_ascii_lowercase().contains("csgo/addons/metamod"));

        apply_launch_mode(&root, LaunchMode::Online).unwrap();
        let online = fs::read_to_string(root.join("gameinfo.gi")).unwrap();
        assert!(online.contains("NewDepotSetting"));
        assert!(!online.to_ascii_lowercase().contains("csgo/addons/metamod"));
        assert_eq!(fs::read(root.join("backup/Online/gameinfo.gi")).unwrap(), current);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn online_mode_removes_only_the_metamod_search_path() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let bots = b"SearchPaths\n{\n\tGame csgo/addons/metamod\n\tGame csgo\n}\nCurrentSetting 1\n";
        fs::write(root.join("gameinfo.gi"), bots).unwrap();

        apply_launch_mode(&root, LaunchMode::Online).unwrap();
        let online = fs::read_to_string(root.join("gameinfo.gi")).unwrap();
        assert!(!online.contains("csgo/addons/metamod"));
        assert!(online.contains("CurrentSetting 1"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bot_mode_requires_the_primary_csgo_search_path() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("gameinfo.gi"), "SearchPaths\n{\nGame core\n}\n").unwrap();

        let error = apply_launch_mode(&root, LaunchMode::Bots).unwrap_err();
        assert!(error.contains("no primary 'Game csgo'"));
        fs::remove_dir_all(root).unwrap();
    }
}
