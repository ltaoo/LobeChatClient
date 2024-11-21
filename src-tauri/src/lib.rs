use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
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

#[cfg(windows)]
pub const NPM: &'static str = "npm.cmd";

#[cfg(not(windows))]
pub const NPM: &'static str = "npm";

struct AppState {
    pub pty_pair: AsyncMutex<PtyPair>,
    pub writer: AsyncMutex<Box<dyn Write + Send>>,
}

#[derive(Clone, serde::Serialize)]
struct Payload {
    message: String,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

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
    write!(state.writer.lock().await, "{}", data).map_err(|_| ());

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

// #[tauri::command]
// // create a shell and add to it the $TERM env variable so we can use clear and other commands
// async fn async_shell(state: State<'_, AppState>) -> Result<(), String> {
//     #[cfg(target_os = "windows")]
//     let mut cmd = CommandBuilder::new("powershell.exe");

//     #[cfg(not(target_os = "windows"))]
//     let mut cmd = CommandBuilder::new("bash");

//     // add the $TERM env variable so we can use clear and other commands

//     #[cfg(target_os = "windows")]
//     cmd.env("TERM", "cygwin");

//     #[cfg(not(target_os = "windows"))]
//     cmd.env("TERM", "xterm-256color");

//     let mut child = state
//         .pty_pair
//         .lock()
//         .await
//         .slave
//         .spawn_command(cmd)
//         .map_err(|err| err.to_string())?;

//     thread::spawn(move || {
//         let status = child.wait().unwrap();
//         exit(status.exit_code() as i32)
//     });

//     Ok(())
// }

// #[tauri::command]
// async fn write_to_pty(data: &str, state: State<'_, AppState>) -> Result<(), ()> {
//     write!(state.writer.lock().await, "{}", data).map_err(|_| ());

//     Ok(())
// }

// #[tauri::command]
// async fn async_read_from_pty(state: State<'_, AppState>) -> Result<Option<String>, ()> {
//     let mut reader = state.reader.lock().await;
//     let data = {
//         // Read all available text
//         let data = reader.fill_buf().map_err(|_| ())?;

//         // Send te data to the webview if necessary
//         if data.len() > 0 {
//             std::str::from_utf8(data)
//                 .map(|v| Some(v.to_string()))
//                 .map_err(|_| ())?
//         } else {
//             None
//         }
//     };

//     if let Some(data) = &data {
//         reader.consume(data.len());
//     }

//     Ok(data)
// }

// #[tauri::command]
// async fn resize_pty(rows: u16, cols: u16, state: State<'_, AppState>) -> Result<(), ()> {
//     state
//         .pty_pair
//         .lock()
//         .await
//         .master
//         .resize(PtySize {
//             rows,
//             cols,
//             ..Default::default()
//         })
//         .map_err(|_| ());

//     Ok(())
// }

// #[tauri::command]
// fn start_lobe_chat<R: Runtime>(app: AppHandle<R>) -> String {
//     // let dir1 = "/Users/litao/Program Files/nodejs";
//     // let dir2 = "/Users/litao/Documents/workspace/lobe-chat";
//     let dir2 = "/Users/litao/Documents/temp/fake_npm_start";
//     env::set_current_dir(dir2).expect("Failed to change directory");
//     let child_process = Command::new(NPM)
//         .args(["run", "start"])
//         .stdin(Stdio::piped())
//         .stdout(Stdio::piped())
//         .stderr(Stdio::piped())
//         .current_dir(PathBuf::from_iter([dir2]))
//         .spawn();

//     match child_process {
//         Ok(mut child) => {
//             // let c = Arc::new(child);
//             // let child = Arc::new(Mutex::new(child));
//             // let mut state = state.lock().unwrap();
//             // state.next_server = Some(child);
//             // let child_process_for_kill = Arc::clone(&child);
//             let stdin = Arc::new(Mutex::new(
//                 child.stdin.take().expect("child should have a stdin"),
//             ));
//             let mut stdin_writer = stdin;
//             app.listen("window-close", {
//                 move |_| {
//                     // writeln!(stdin_writer, "F\n");
//                     // let _ = child.kill();
//                 }
//             });
//             // let app = Arc::new(Mutex::new(app));
//             // let child_process_for_stdout = Arc::clone(&child);
//             // let app_for_stdout = Arc::clone(&app);
//             // let mut child = child_process_for_stdout.lock().unwrap();
//             // let mut app = app_for_stdout.lock().unwrap();
//             // let stdout = child.stdout.take().expect("Failed to open stdout");

//             let stdout_reader = Arc::new(Mutex::new(
//                 child.stdout.take().expect("Failed to get stdout"),
//             ));
//             let stderr_reader = Arc::new(Mutex::new(
//                 child.stderr.take().expect("Failed to get stderr"),
//             ));
//             let stdout_reader_clone = Arc::clone(&stdout_reader);
//             std::thread::spawn(move || {
//                 let stdout = stdout_reader_clone
//                     .lock()
//                     .expect("Failed to lock stdout_reader");
//                 let reader = std::io::BufReader::new(stdout);
//                 let lines = reader.lines();
//                 // println!("stdout {}", std::str::from_utf8(lines).unwrap());
//                 for line in lines {
//                     let line = line.expect("Failed to read line");
//                     let _ = app.emit("command-output", Payload { message: line });
//                 }
//             });
//             let stderr_reader_clone = Arc::clone(&stderr_reader);
//             std::thread::spawn(move || {
//                 let stderr = stderr_reader_clone
//                     .lock()
//                     .expect("Failed to lock stderr_reader");
//                 let reader = std::io::BufReader::new(*stderr);
//                 let lines = reader.lines();
//                 // println!("stderr {}", std::str::from_utf8(lines).unwrap());
//                 // let lines2 = reader2.lines();
//                 for line in lines {
//                     let line = line.expect("Failed to read line");
//                     // let _ = app.emit("command-output", Payload { message: line });
//                 }
//             });

//             // let reader = std::io::BufReader::new(stdout);
//             // let reader2 = std::io::BufReader::new(stderr);

//             // let _ = app.emit(
//             //     "command-output",
//             //     Payload {
//             //         message: "__FINISH".into(),
//             //     },
//             // );
//             // let child_process_for_stderr = Arc::clone(&child);
//             // let app_for_stderr = Arc::clone(&app);
//             // std::thread::spawn(move || {
//             //     let mut child = child_process_for_stderr.lock().unwrap();
//             //     let mut app = app_for_stderr.lock().unwrap();
//             //     let stderr = child.stderr.as_mut().expect("Failed to open stderr");
//             //     let reader2 = std::io::BufReader::new(stderr);
//             //     let lines2 = reader2.lines();
//             //     for line in lines2 {
//             //         let line = line.expect("Failed to read line");
//             //         let _ = app.emit("command-output", Payload { message: line });
//             //     }
//             // });
//             // let _ = child.wait().expect("Process wasn't running");
//             return format!("ok");
//         }
//         Err(e) => {
//             return format!("Error:\n{}", e);
//         }
//     }
//     return format!("ok!!");
// }

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
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            check_has_nodejs,
            write_to_pty,
            resize_pty,
            async_shell,
        ])
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
                // write_to_pty("\x03".to_string(), state);
                // if let Some(mut child) = app_state.next_server.take() {
                //     let _ = child.kill();
                // }
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
