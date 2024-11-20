use std::env;
use std::io::BufRead;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Child;
use std::process::Command;
use std::process::Stdio;

use once_cell::sync::OnceCell;
use tauri::App;
use tauri::AppHandle;
use tauri::Emitter;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn check_has_nodejs() -> String {
    match Command::new("node").arg("-v").output() {
        Ok(output) => {
            if output.status.success() {
                // 成功获取 Node.js 版本
                let version = String::from_utf8_lossy(&output.stdout);
                return format!("Node.js is installed. Version: {}", version.trim());
            } else {
                // Node.js 未安装或出错
                return format!("Node.js is not installed or there was an error.");
            }
        }
        Err(e) => {
            return format!("Failed to execute command: {}", e);
        }
    }
}

#[cfg(windows)]
pub const NPM: &'static str = "npm.cmd";

#[cfg(not(windows))]
pub const NPM: &'static str = "npm";

static GLOBAL_APP: OnceCell<App> = OnceCell::new();

#[derive(Default)]
struct AppState {
    next_server: Option<Child>,
}

#[derive(Clone, serde::Serialize)]
struct Payload {
    message: String,
}

#[tauri::command]
fn start_lobe_chat(app: AppHandle) -> String {
    // let dir1 = "/Users/litao/Program Files/nodejs";
    let dir2 = "/Users/litao/Documents/workspace/lobe-chat";
    env::set_current_dir(dir2).expect("Failed to change directory");
    let mut child_process = Command::new(NPM)
        .args(["run", "start"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(PathBuf::from_iter([dir2]))
        .spawn();

    match child_process {
        Ok(mut child) => {
            let mut state = state.lock().unwrap();
            state.next_server = Some(child);
            std::thread::spawn(move || {
                let stdout = child.stdout.as_mut().expect("Failed to open stdout");
                let stderr = child.stderr.as_mut().expect("Failed to open stderr");
                let reader = std::io::BufReader::new(stdout);
                let lines = reader.lines();
                for line in lines {
                    let line = line.expect("Failed to read line");
                    let _ = app.emit("command-output", Payload { message: line });
                }
                let reader2 = std::io::BufReader::new(stderr);
                let lines2 = reader2.lines();
                for line in lines2 {
                    let line = line.expect("Failed to read line");
                    let _ = app.emit("command-output", Payload { message: line });
                }
            });
            // let _ = child.wait().expect("Process wasn't running");
            return format!("ok");
        }
        Err(e) => {
            return format!("Error:\n{}", e);
        }
    }
    return format!("ok!!");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|event| match event {
            WindowEvent::CloseRequested => {
                let app_handle = event.window().app_handle();
                let state = app_handle.state::<AppState>();
                if let Some(child) = &mut state.next_server {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                println!("Application is closing. Child process terminated.");
            }
            (_) => {}
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            check_has_nodejs,
            start_lobe_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
