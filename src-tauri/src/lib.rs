use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{exit, Child, Command, Stdio};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::thread::{self, sleep};
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use tauri::async_runtime::Mutex as AsyncMutex;
#[allow(unused)]
use tauri::{
    App, AppHandle, Context, Emitter, Listener, Manager, RunEvent, Runtime, State, WebviewUrl,
};
use tauri_plugin_store::StoreExt;

struct AppState {
    pub pty_pair: AsyncMutex<PtyPair>,
    pub writer: AsyncMutex<Box<dyn Write + Send>>,
}

fn get_document_dir() -> PathBuf {
    let mut document_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    let application_dir: PathBuf = document_dir.to_path_buf().join("lobe_chat_client");
    if !fs::metadata(application_dir.clone()).is_ok() {
        fs::create_dir_all(application_dir.clone());
    }
    application_dir
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
async fn async_shell(state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = CommandBuilder::new("powershell.exe");
    #[cfg(target_os = "windows")]
    cmd.env("TERM", "cygwin");
    #[cfg(not(target_os = "windows"))]
    let mut cmd = CommandBuilder::new("bash");
    #[cfg(not(target_os = "windows"))]
    cmd.env("TERM", "xterm-256color");

    let mut child = state
        .pty_pair
        .lock()
        .await
        .slave
        .spawn_command(cmd)
        .map_err(|err| err.to_string())?;

    thread::spawn(move || {
        let status = child.wait().unwrap();
        exit(status.exit_code() as i32)
    });

    Ok(())
}

#[tauri::command]
async fn write_to_pty(data: String, state: State<'_, AppState>) -> Result<(), ()> {
    let w = state.writer.lock().await;
    write!(w, "{}", data).map_err(|_| ());

    Ok(())
}

#[tauri::command]
async fn resize_pty(rows: u16, cols: u16, state: State<'_, AppState>) -> Result<(), ()> {
    state
        .pty_pair
        .lock()
        .await
        .master
        .resize(PtySize {
            rows,
            cols,
            ..Default::default()
        })
        .map_err(|_| ());

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();

    let reader = pty_pair.master.try_clone_reader().unwrap();
    let writer = pty_pair.master.take_writer().unwrap();

    let reader = Arc::new(Mutex::new(Some(BufReader::new(reader))));
    let output = Arc::new(Mutex::new(String::new()));

    let state = AppState {
        pty_pair: AsyncMutex::new(pty_pair),
        writer: AsyncMutex::new(writer),
    };

    let app = tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            write_to_pty,
            resize_pty,
            async_shell,
        ])
        .setup(move |app| {
            let store = app.store("store.json")?;
            let dir = app.path().app_data_dir().unwrap();
            store.set("app_dir", dir.to_string_lossy());
            let lobe_repo_dir: PathBuf = dir.to_path_buf().join("lobe-chat");
            if fs::metadata(lobe_repo_dir.clone()).is_ok() {
                store.set("lobe_chat_repo_dir", lobe_repo_dir.to_string_lossy());
            }
            let lobe_build_dir: PathBuf = lobe_repo_dir.to_path_buf().join(".next");
            if fs::metadata(lobe_build_dir.clone()).is_ok() {
                store.set("lobe_chat_build_dir", lobe_build_dir.to_string_lossy());
            }
            // store.set("lobe_chat_server_port", "8100".to_string());
            let GITHUB_PROXY_URL = "https://ghp.ci";
            let LOBE_CHAT_GIT_REPOSITORY_URL = "https://github.com/lobehub/lobe-chat";
            let NPM_REGISTER_MIRROR_URL = "https://registry.npmmirror.com";
            store.set("github_proxy_url", GITHUB_PROXY_URL);
            store.set("lobe_chat_repo_url", LOBE_CHAT_GIT_REPOSITORY_URL);
            store.set("npm_register_mirror_url", NPM_REGISTER_MIRROR_URL);
            Ok(())
        })
        .on_page_load(move |window, _| {
            let window = window.clone();
            let reader = reader.clone();
            let output = output.clone();

            thread::spawn(move || {
                let reader = reader.lock().unwrap().take();
                if let Some(mut reader) = reader {
                    loop {
                        sleep(Duration::from_millis(1));
                        let data = reader.fill_buf().unwrap().to_vec();
                        reader.consume(data.len());
                        if data.len() > 0 {
                            output
                                .lock()
                                .unwrap()
                                .push_str(&String::from_utf8_lossy(&data));
                            window.emit("data", data).unwrap();
                        }
                    }
                }
            });

        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|_app_handle, _event| {
        match &_event {
            RunEvent::WindowEvent {
                event: tauri::WindowEvent::CloseRequested { api, .. },
                label,
                ..
            } => {
                println!("closing window...");
                // run the window destroy manually just for fun :)
                // usually you'd show a dialog here to ask for confirmation or whatever
                // let app_state = _app_handle.emit("window-close", {});
                // _app_handle
                //     .get_webview_window(label)
                //     .unwrap()
                //     .destroy()
                //     .unwrap();
            }
            _ => (),
        }
    });
}
