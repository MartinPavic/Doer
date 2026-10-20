use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};
mod scheduler;

use tauri_plugin_autostart::MacosLauncher;

const KEYCHAIN_SERVICE: &str = "com.doer.app";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_remove(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(serde::Serialize)]
struct DeviceInfo {
    id: String,
    label: String,
}

/// Stable identity of this install: a UUID persisted in the app config dir (the server keys
/// "alert on this device?" off it, and the reminder scheduler uses the same id).
fn device_id(app: &AppHandle) -> String {
    let path = app.path().app_config_dir().ok().map(|d| d.join("device-id"));
    if let Some(p) = &path {
        if let Ok(existing) = std::fs::read_to_string(p) {
            let id = existing.trim().to_string();
            if !id.is_empty() {
                return id;
            }
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    if let Some(p) = &path {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let _ = std::fs::write(p, &id);
    }
    id
}

#[tauri::command]
fn device_info(app: AppHandle) -> DeviceInfo {
    DeviceInfo { id: device_id(&app), label: device_label() }
}

fn device_label() -> String {
    let label = std::process::Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Mac".into());
    label
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

/// Dock-icon preference lives in a marker file so Rust can apply it before any webview loads.
fn dock_hidden_marker(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("hide-dock"))
}

/// A plain window can't sit above another app's full-screen Space; join all Spaces as a
/// full-screen auxiliary window at status level instead. (Reliable only without a Dock icon.)
#[cfg(target_os = "macos")]
fn float_over_fullscreen(w: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior as B};
    if let Ok(ptr) = w.ns_window() {
        // SAFETY: called on the main thread (setup/menu handlers); the pointer is the live NSWindow.
        let win: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
        win.setCollectionBehavior(
            B::CanJoinAllSpaces | B::Stationary | B::FullScreenAuxiliary | B::IgnoresCycle,
        );
        win.setLevel(25); // NSStatusWindowLevel
    }
}

fn toggle_bubble(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("bubble") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Doer", true, None::<&str>)?;
    let bubble = MenuItem::with_id(app, "bubble", "Show/Hide Bubble", true, None::<&str>)?;
    let hidden = dock_hidden_marker(app).is_some_and(|p| p.exists());
    let dock = CheckMenuItem::with_id(app, "dock", "Hide Dock Icon", true, hidden, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Doer", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &bubble, &dock, &quit])?;
    TrayIconBuilder::with_id("tray")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "bubble" => toggle_bubble(app),
            "dock" => {
                if let Some(marker) = dock_hidden_marker(app) {
                    let hide = !marker.exists();
                    if hide {
                        let _ = std::fs::create_dir_all(marker.parent().unwrap());
                        let _ = std::fs::write(&marker, "");
                    } else {
                        let _ = std::fs::remove_file(&marker);
                    }
                    let _ = app.set_dock_visibility(!hide);
                    // Leaving the Dock can drop the app out of focus; keep the window reachable.
                    if !hide { show_main(app); }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just focuses the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![secure_get, secure_set, secure_remove, show_main_window, device_info, scheduler::sync_reminders])
        .setup(|app| {
            setup_tray(app.handle())?;
            scheduler::start(app.handle().clone(), device_id(app.handle()), device_label());
            if dock_hidden_marker(app.handle()).is_some_and(|p| p.exists()) {
                let _ = app.set_dock_visibility(false);
            }
            #[cfg(target_os = "macos")]
            if let Some(b) = app.get_webview_window("bubble") {
                float_over_fullscreen(&b);
            }
            // Launched at login: stay in the tray so the reminder scheduler (Phase 4) runs unseen.
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it; the app keeps running in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
