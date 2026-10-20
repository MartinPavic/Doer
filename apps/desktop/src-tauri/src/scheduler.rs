//! Desktop reminder scheduler. Tauri's notification plugin can't schedule on desktop, so a Rust task
//! keeps a local copy of the user's upcoming reminders and fires them itself:
//!
//! - every 30s (or when the UI pokes `sync_reminders`) it fetches `/reminders/upcoming` with the token from
//!   the Keychain; offline it just keeps firing from the last copy, which is also persisted to disk;
//! - every 5s it fires anything due. Reminders from the last 24h still fire, so a Mac that slept
//!   through one alerts on wake. What was already shown is remembered per (id, fire time), so a
//!   snooze (new fire time) alerts again but a restart doesn't repeat itself.

use std::{collections::HashMap, path::PathBuf, sync::{Arc, Mutex}, time::Duration};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;

const API_URL: &str = match option_env!("DOER_API_URL") {
    Some(u) => u,
    None => "http://localhost:8787",
};
const SYNC_EVERY: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(5);
const GRACE: chrono::Duration = chrono::Duration::hours(24);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Upcoming {
    id: String,
    profile_name: String,
    title: String,
    fire_at: DateTime<Utc>,
}

pub struct Scheduler {
    upcoming: Mutex<Vec<Upcoming>>,
    /// reminder id -> the fire time we already alerted for
    shown: Mutex<HashMap<String, DateTime<Utc>>>,
    wake: Notify,
}

impl Scheduler {
    /// Ask the sync loop to refresh now (e.g. right after the user edited a task).
    pub fn poke(&self) {
        self.wake.notify_one();
    }
}

fn file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(name))
}

fn load<T: for<'de> Deserialize<'de> + Default>(app: &AppHandle, name: &str) -> T {
    file(app, name)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save<T: Serialize>(app: &AppHandle, name: &str, value: &T) {
    if let Some(p) = file(app, name) {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        if let Ok(b) = serde_json::to_vec(value) {
            let _ = std::fs::write(p, b);
        }
    }
}

#[tauri::command]
pub fn sync_reminders(state: tauri::State<'_, Arc<Scheduler>>) {
    state.poke();
}

pub fn start(app: AppHandle, device_id: String, device_label: String) {
    let state = Arc::new(Scheduler {
        upcoming: Mutex::new(load(&app, "upcoming.json")),
        shown: Mutex::new(load(&app, "shown.json")),
        wake: Notify::new(),
    });
    app.manage(state.clone());
    let _ = app.notification().request_permission();

    let (a, s) = (app.clone(), state.clone());
    tauri::async_runtime::spawn(async move {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().expect("http client");
        loop {
            if let Err(e) = sync(&a, &s, &http, &device_id, &device_label).await {
                eprintln!("[scheduler] sync skipped: {e}");
            }
            tokio::select! {
                _ = tokio::time::sleep(SYNC_EVERY) => {}
                _ = s.wake.notified() => tokio::time::sleep(Duration::from_millis(400)).await,
            }
        }
    });

    tauri::async_runtime::spawn(async move {
        loop {
            fire_due(&app, &state);
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

async fn sync(app: &AppHandle, s: &Scheduler, http: &reqwest::Client, id: &str, label: &str) -> Result<(), String> {
    let token = keyring::Entry::new("com.doer.app", "session-token")
        .and_then(|e| e.get_password())
        .map_err(|e| match e {
            keyring::Error::NoEntry => "not signed in".to_string(),
            other => format!("keychain unavailable: {other}"),
        })?;

    // Heartbeat: makes sure the server knows this device even if the UI never opened (autostart).
    // Doesn't send notifyHere, so the user's choice is never overwritten.
    http.put(format!("{API_URL}/devices/{id}"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "kind": "desktop", "label": label }))
        .send().await.map_err(|e| e.to_string())?;

    let res = http
        .get(format!("{API_URL}/reminders/upcoming?deviceId={id}")) // id is a UUID: no escaping needed
        .bearer_auth(&token)
        .send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server said {}", res.status()));
    }
    let list: Vec<Upcoming> = res.json().await.map_err(|e| e.to_string())?;
    save(app, "upcoming.json", &list);
    *s.upcoming.lock().unwrap() = list;
    Ok(())
}

fn fire_due(app: &AppHandle, s: &Scheduler) {
    let now = Utc::now();
    let due: Vec<Upcoming> = {
        let shown = s.shown.lock().unwrap();
        s.upcoming
            .lock().unwrap()
            .iter()
            .filter(|r| r.fire_at <= now && now - r.fire_at < GRACE && shown.get(&r.id) != Some(&r.fire_at))
            .cloned()
            .collect()
    };
    if due.is_empty() {
        return;
    }
    let mut shown = s.shown.lock().unwrap();
    for r in &due {
        let sent = app.notification().builder().title(&r.title).body(&r.profile_name).show();
        if let Err(e) = sent {
            eprintln!("[scheduler] notification failed: {e}");
        }
        shown.insert(r.id.clone(), r.fire_at);
    }
    // Forget alerts for reminders the server no longer lists, so the file doesn't grow forever.
    let live: Vec<String> = s.upcoming.lock().unwrap().iter().map(|r| r.id.clone()).collect();
    shown.retain(|id, _| live.contains(id));
    save(app, "shown.json", &*shown);
    drop(shown);
    // Tell the windows so the in-app alert list shows it immediately.
    let _ = app.emit("data:changed", ());
}
