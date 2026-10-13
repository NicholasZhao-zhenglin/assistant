mod model;
mod storage;
#[cfg(test)]
mod tests;

use model::{Attachment, Entry, Snapshot};
use std::{path::PathBuf, sync::Mutex};
use storage::Store;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

type AppStore = Mutex<Store>;
fn lock<'a>(
    state: &'a tauri::State<'_, AppStore>,
) -> Result<std::sync::MutexGuard<'a, Store>, String> {
    state
        .lock()
        .map_err(|_| "存储暂时不可用，请重新启动应用".into())
}
#[tauri::command]
fn get_snapshot(state: tauri::State<AppStore>) -> Result<Snapshot, String> {
    lock(&state)?.snapshot()
}
#[tauri::command]
fn save_entry(state: tauri::State<AppStore>, entry: Entry) -> Result<Snapshot, String> {
    lock(&state)?.save(entry)
}
#[tauri::command]
fn triage_item(
    state: tauri::State<AppStore>,
    source_id: String,
    destinations: Vec<Entry>,
) -> Result<Snapshot, String> {
    lock(&state)?.triage(&source_id, destinations)
}
#[tauri::command]
fn import_attachment(state: tauri::State<AppStore>, path: String) -> Result<Attachment, String> {
    lock(&state)?.import_file(&PathBuf::from(path))
}
#[tauri::command]
fn open_attachment(state: tauri::State<AppStore>, id: String) -> Result<(), String> {
    let store = lock(&state)?;
    let a = store
        .snapshot()?
        .attachments
        .into_iter()
        .find(|a| a.id == id)
        .ok_or("附件不存在")?;
    open::that(store.attachment_path(&a)).map_err(|e| e.to_string())
}
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只支持 HTTP 或 HTTPS 链接".into());
    }
    open::that(url).map_err(|e| e.to_string())
}
#[tauri::command]
fn create_backup(state: tauri::State<AppStore>, path: String) -> Result<(), String> {
    lock(&state)?.backup(&PathBuf::from(path))
}
#[tauri::command]
fn restore_backup(state: tauri::State<AppStore>, path: String) -> Result<Snapshot, String> {
    lock(&state)?.restore(&PathBuf::from(path))
}
#[tauri::command]
fn data_directory(state: tauri::State<AppStore>) -> Result<String, String> {
    Ok(lock(&state)?.root.to_string_lossy().into())
}

fn show(app: &tauri::AppHandle, capture: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if capture {
        let _ = app.emit("quick-capture", ());
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show(app, false)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        show(app, true);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Tests use explicit temporary roots; production always uses the OS application-data directory.
            let root = app.path().app_data_dir()?;
            app.manage(Mutex::new(Store::new(root).map_err(std::io::Error::other)?));
            if let Err(error) = app
                .global_shortcut()
                .register("CommandOrControl+Shift+Space")
            {
                eprintln!("快捷键未注册，仍可从菜单栏快速记录：{error}");
            }
            let open = MenuItem::with_id(app, "open", "打开栖序", true, None::<&str>)?;
            let capture = MenuItem::with_id(app, "capture", "快速记录", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出栖序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &capture, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("栖序 · 个人助手")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app, false),
                    "capture" => show(app, true),
                    "quit" => app.exit(0),
                    _ => (),
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            save_entry,
            triage_item,
            import_attachment,
            open_attachment,
            open_link,
            create_backup,
            restore_backup,
            data_directory
        ])
        .run(tauri::generate_context!())
        .expect("无法启动栖序");
}
