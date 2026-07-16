#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if cs2_bot_improver_plus_panel_lib::maybe_run_update_helper() { return; }
    cs2_bot_improver_plus_panel_lib::run();
}
