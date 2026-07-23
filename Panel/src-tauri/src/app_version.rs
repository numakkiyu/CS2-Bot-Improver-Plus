use std::sync::OnceLock;

pub const SEMVER: &str = env!("CARGO_PKG_VERSION");

pub fn display() -> &'static str {
    static DISPLAY: OnceLock<String> = OnceLock::new();
    DISPLAY.get_or_init(|| {
        let Some((core, suffix)) = SEMVER.split_once("-preview.") else {
            return SEMVER.to_string();
        };
        let Some((preview, revision)) = suffix.split_once('+') else {
            return SEMVER.to_string();
        };
        format!("{core}.{revision}-Preview.{preview}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_semver_maps_to_the_four_part_display_version() {
        assert_eq!(display(), "1.4.2.6-Preview.1");
    }
}
