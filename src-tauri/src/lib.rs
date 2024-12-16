use std::env;
use std::fs;
use std::fs::File;
use std::io;
use std::io::{BufRead, BufReader, Cursor, Read, Write};
// use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{exit, Child, Command, Stdio};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::thread::{self, sleep};
use std::time::Duration;

use futures_util::stream::StreamExt;
use futures_util::TryStreamExt;
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use reqwest::blocking::get;
use reqwest::Client;
use reqwest::Response;
use serde::{Deserialize, Serialize};
use serde_json::{json, Deserializer, Serializer, Value};
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::window;
use tauri::PhysicalSize;
use tauri::Size;
#[allow(unused)]
use tauri::{
    App, AppHandle, Context, Emitter, Listener, Manager, RunEvent, Runtime, State, WebviewUrl,
    WebviewWindow,
};
use tauri_plugin_store::StoreExt;
use thiserror;
use zip::ZipArchive;

struct AppState {
    pub deno_bin: String,
    pub deno_existing: bool,
    pub lobe_chat_dir: String,
    pub pty_pair: AsyncMutex<PtyPair>,
    pub writer: AsyncMutex<Box<dyn Write + Send>>,
}

// create the error type that represents all errors possible in our program
#[derive(Debug, thiserror::Error)]
enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
// we must manually implement serde::Serialize
impl serde::Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct BizResponse {
    code: i32,
    msg: String,
    data: String,
}
impl BizResponse {
    fn new(code: i32, msg: &str, data: &str) -> Self {
        Self {
            code,
            msg: String::from(msg),
            data: String::from(data),
        }
    }
    fn to_str(&self) -> String {
        let r = serde_json::to_string(self);
        if r.is_err() {
            let code = 1;
            let msg = "serde failed";
            return format!(r#"{{"code":{},"msg":"{}","data":{}}}"#, code, msg, "");
        }
        return r.unwrap();
    }
}

fn get_document_dir() -> PathBuf {
    let mut document_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let application_dir: PathBuf = document_dir.to_path_buf().join("lobe_chat_client");
    if !fs::metadata(application_dir.clone()).is_ok() {
        fs::create_dir_all(application_dir.clone());
    }
    application_dir
}
fn is_directory_exists(path: &PathBuf) -> bool {
    fs::metadata(&path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}
fn get_file_parent_directory(path: &PathBuf) -> Option<PathBuf> {
    path.parent().map(|p| p.to_path_buf())
}
async fn download_deno(window: tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    println!("download deno");
    window
        .emit("data", "download deno".as_bytes().to_vec())
        .unwrap();
    // Initialize variables
    let deno_version = String::from("2.1.4");
    // deno_version = get("https://dl.deno.land/release-latest.txt")
    //     .unwrap()
    //     .text()
    //     .unwrap();
    let target = match std::env::consts::OS {
        "windows" => "x86_64-pc-windows-msvc",
        "macos" => {
            if cfg!(target_pointer_width = "64") {
                "x86_64-apple-darwin"
            } else {
                "aarch64-apple-darwin"
            }
        }
        "linux" => {
            if cfg!(target_pointer_width = "64") {
                "x86_64-unknown-linux-gnu"
            } else {
                "aarch64-unknown-linux-gnu"
            }
        }
        _ => "x86_64-unknown-linux-gnu",
    };
    // https://github.com/denoland/deno/releases/download/v2.1.4/deno-aarch64-apple-darwin.zip
    let deno_uri = format!(
        "https://ghp.ci/https://github.com/denoland/deno/releases/download/v{}/deno-{}.zip",
        deno_version, target
    );
    println!("download deno from {}", deno_uri);
    window.emit(
        "data",
        format!("download deno from {}", deno_uri)
            .as_bytes()
            .to_vec(),
    );
    let deno_install = env::var("DENO_INSTALL")
        .unwrap_or_else(|_| format!("{}/.deno", dirs::home_dir().unwrap().display()));
    let bin_dir = PathBuf::from(&deno_install).join("bin");
    let filename = PathBuf::from(format!("deno-{}-{}.zip", deno_version, target));
    let zip_path = bin_dir.join(filename);
    let exe_path = bin_dir.join("deno");
    println!("download deno to {}", deno_install);

    fs::create_dir_all(&bin_dir).unwrap();

    if !zip_path.exists() {
        let client = Client::new();
        let mut response = client.get(deno_uri).send().await?;
        if !response.status().is_success() {
            println!(
                "Error: Failed to download the file - Status: {}",
                response.status()
            );
            window
                .emit(
                    "data",
                    format!(
                        "Error: Failed to download the file - Status: {}",
                        response.status()
                    ),
                )
                .unwrap();
            return Ok(());
        }
        let mut file = File::create(&zip_path).expect("Unable to create file");
        let mut writer = io::BufWriter::new(file);
        let mut downloaded: u64 = 0;
        let total_size = response
            .content_length()
            .ok_or("Could not get content length")?;

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            downloaded += chunk.len() as u64;
            println!("downloaded {}", downloaded);
            writer.write_all(&chunk)?;
            let percentage = downloaded as f64 / total_size as f64 * 100.0;
            let msg = format!("Download progress: {:.2}%", percentage);
            // println!("{}", msg);
            window.emit("data", msg.as_bytes().to_vec()).unwrap();
        }
        writer.flush()?;
    }

    let mut archive =
        ZipArchive::new(File::open(&zip_path).expect("Failed to open ZIP file")).unwrap();
    archive.extract(&bin_dir).unwrap();

    // fs::remove_file(zip_path).expect("Failed to delete ZIP file");

    // Make the executable
    Command::new("chmod")
        .arg("+x")
        .arg(&exe_path)
        .output()
        .unwrap();
    // println!("Deno was installed successfully to {:?}", exe_path);

    // let output = Command::new(exe_path.clone())
    //     .arg("run")
    //     .arg("-A")
    //     .arg("--reload")
    //     .arg("jsr:@deno/installer-shell-setup/bundled")
    //     .arg(deno_install)
    //     .arg("-y")
    //     .output()
    //     .expect("Failed to run shell setup");

    // if !output.status.success() {
    //     let msg = format!(
    //         "Shell setup failed:\n{}",
    //         String::from_utf8_lossy(&output.stderr)
    //     );
    //     window.emit("data", msg.as_bytes().to_vec());
    //     return Ok(());
    // }
    window
        .emit(
            "can_download_lobe_chat",
            json!({"bin_path": exe_path.display().to_string()}),
        )
        .unwrap();

    return Ok(());
}

fn extract_zip(zip_path: PathBuf, output_folder: &PathBuf) -> Result<String, String> {
    let zip_file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(zip_file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = Path::new(&output_folder).join(file.sanitized_name());

        // 确保输出目录存在
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // 解压文件
        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            let mut out_file = File::create(&out_path).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    return Ok(format!("ok"));
}

async fn download_zip_file_then_unzip(
    url: String,
    filepath: PathBuf,
    window: tauri::Window,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("_download file from {} to {:?}", url, filepath);
    if !filepath.exists() {
        let client = Client::new();
        let mut response = client.get(url).send().await?;
        if !response.status().is_success() {
            println!("Failed to download file: {}", response.status());
            return Ok(());
        }
        println!("response is success");
        let mut downloaded: u64 = 0;
        let file = File::create(&filepath)?;
        let mut writer = io::BufWriter::new(file);
        let total_size = response
            .content_length()
            .ok_or("Could not get content length")?;
        println!("the response size is {}", total_size);
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            println!("calc progress");
            let chunk = chunk?;
            downloaded += chunk.len() as u64;
            println!("downloaded {}", downloaded);
            writer.write_all(&chunk)?;
            // 显示进度
            let percentage = downloaded as f64 / total_size as f64 * 100.0;
            let msg = format!("Download progress: {:.2}%", percentage);
            println!("{}", msg);
            window.emit("data", msg.as_bytes().to_vec()).unwrap();
        }
        writer.flush()?;
    }
    match get_file_parent_directory(&filepath) {
        Some(parent) => {
            let zip_folder = parent.join(filepath.file_stem().unwrap());
            if is_directory_exists(&zip_folder) {
                extract_zip(filepath, &zip_folder);
            }
            window.emit(
                "can_start_lobe_chat_server",
                json!({"lobe_chat_path": zip_folder}),
            );
        }
        None => return Ok(()),
    }
    return Ok(());
}

#[tauri::command]
async fn download_file(
    url: String,
    path: String,
    window: tauri::Window,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, Error> {
    // let window = app.get_webview_window("setup").unwrap();
    // window.emit("data", "Start download LobeChat.zip");
    let store = app.store("store.json");
    if store.is_err() {
        return Ok(json!({
            "code": 101,
            "msg": "fetch store failed",
            "data": None::<String>,
        })
        .to_string());
    }
    let store = store.unwrap();
    let client = Client::new();
    let r = client.head(url.clone()).send().await;
    if r.is_err() {
        return Ok(json!({
            "code": 101,
            "msg": "fetch url failed",
            "data": None::<String>,
        })
        .to_string());
    }
    let response1 = r.unwrap();
    if !response1.status().is_success() {
        return Ok(json!({
            "code": 101,
            "msg": "response is not ok",
            "data": None::<String>,
        })
        .to_string());
    }
    let cloned_window = window.clone();
    let url_clone = url.clone();
    // let save_path_clone = save_path.clone();
    let app_dir_str = store.get("app_dir");
    if app_dir_str.is_none() {
        return Ok(json!({
            "code": 101,
            "msg": "there is no app_dir",
            "data": None::<String>,
        })
        .to_string());
    }
    let app_dir_str1 = app_dir_str.unwrap();
    let a = app_dir_str1.as_str();
    if a.is_none() {
        return Ok(json!({
            "code": 101,
            "msg": "there is no app_dir2",
            "data": None::<String>,
        })
        .to_string());
    }
    let app_dir_str2 = a.unwrap();
    let mut filepath = PathBuf::from(app_dir_str2);
    filepath.push(path);
    thread::spawn(move || {
        let _ = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(download_zip_file_then_unzip(
                url_clone,
                filepath,
                cloned_window,
            ));
    });
    return Ok(json!({
        "code": 0,
        "msg": "start download file",
        "data": None::<String>,
    })
    .to_string());
}

#[tauri::command]
async fn async_shell(state: State<'_, AppState>) -> Result<String, String> {
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
    return Ok(json!({
        "code": 0,
        "msg": "",
        "data": serde_json::Value::Null,
    })
    .to_string());
}

#[tauri::command]
async fn write_to_pty(data: String, state: State<'_, AppState>) -> Result<(), ()> {
    // println!("write pty {}", data);
    let mut w = state.writer.lock().await;
    write!(w, "{}", data).map_err(|_| ());
    return Ok(());
}

#[tauri::command]
async fn resize_pty(rows: u16, cols: u16, state: State<'_, AppState>) -> Result<String, ()> {
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

    return Ok(json!({
        "code": 0,
        "msg": "",
        "data": serde_json::Value::Null,
    })
    .to_string());
}

#[tauri::command]
fn set_complete(url: String, app: AppHandle) -> Result<String, ()> {
    let setup_window = app.get_webview_window("setup").unwrap();
    // let main_window = app.get_webview_window("main").unwrap();
    setup_window.close().unwrap();
    let main_window = WebviewWindow::builder(
        &app,
        "main",
        tauri::WebviewUrl::App(url.into()),
    )
    .build()
    .unwrap();
    main_window.set_size(PhysicalSize::new(1280, 880));
    main_window.set_title("LobeChatClient");
    main_window.center();
    main_window.show();
    main_window.center();
    // main_window.show().unwrap();
    // let main_window = WindowBuilder::new(
    //     app,
    //     "main",
    //     tauri::WindowUrl::External("http://127.0.0.1:3000".parse().unwrap()),
    // );
    // return Ok(());
    return Ok(json!({
        "code": 0,
        "msg": "",
        "data": serde_json::Value::Null,
    })
    .to_string());
}

#[tauri::command]
fn download_deno_then_enable(app: AppHandle, window: tauri::Window) -> Result<String, ()> {
    let window = app.get_webview_window("setup").unwrap();
    window.emit("data", "Start download deno\r".as_bytes().to_vec());
    let cloned_window = window.clone();
    thread::spawn(move || {
        let _ = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(download_deno(cloned_window));
    });
    return Ok(json!({
        "code": 0,
        "msg": "",
        "data": serde_json::Value::Null,
    })
    .to_string());
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

    let deno_dir = format!("{}/.deno", dirs::home_dir().unwrap().display());
    let deno_bin_dir = PathBuf::from(&deno_dir).join("bin");
    let deno_bin_path = deno_bin_dir.join("deno");
    let deno_bin_existing = deno_bin_path.exists();
    let deno_bin_path_string = deno_bin_path.display().to_string();
    let document_dir = get_document_dir();
    let lobe_build_dir = document_dir
        .join("lobe-chat_v1.36.11")
        .display()
        .to_string();

    let state = AppState {
        deno_bin: deno_bin_path_string.clone(),
        deno_existing: deno_bin_existing,
        lobe_chat_dir: lobe_build_dir.clone(),
        pty_pair: AsyncMutex::new(pty_pair),
        writer: AsyncMutex::new(writer),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(state)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            download_deno_then_enable,
            write_to_pty,
            resize_pty,
            async_shell,
            download_file,
            set_complete,
        ])
        .setup(move |app| {
            // window.emit(
            //     "loaded",
            //     json!({ "deno_bin": deno_bin_path_string, "deno_existing": deno_bin_existing, "lobe_chat_dir": lobe_build_dir }),
            // );
            // let store = app.store("store.json")?;
            // // let dir = app.path().app_data_dir().unwrap();
            // let dir = get_document_dir();
            // store.set("app_dir", dir.to_string_lossy());
            // // let dir2 = dirs::home_dir().unwrap();
            // // store.set("app_dir2", dir2.to_string_lossy());
            // // let lobe_repo_dir: PathBuf = dir.to_path_buf().join("lobe-chat");
            // // if fs::metadata(lobe_repo_dir.clone()).is_ok() {
            // //     store.set("lobe_chat_repo_dir", lobe_repo_dir.to_string_lossy());
            // // }
            // let lobe_build_dir: PathBuf = dir.join("lobe-chat_v1.36.11");
            // if fs::metadata(lobe_build_dir.clone()).is_ok() {
            //     store.set("lobe_chat_build_dir", lobe_build_dir.to_string_lossy());
            // }
            // // store.set("lobe_chat_server_port", "8100".to_string());
            // let GITHUB_PROXY_URL = "https://ghp.ci";
            // let LOBE_CHAT_GIT_REPOSITORY_URL = "https://github.com/lobehub/lobe-chat";
            // let NPM_REGISTER_MIRROR_URL = "https://registry.npmmirror.com";
            // store.set("github_proxy_url", GITHUB_PROXY_URL);
            // store.set("lobe_chat_repo_url", LOBE_CHAT_GIT_REPOSITORY_URL);
            // store.set("npm_register_mirror_url", NPM_REGISTER_MIRROR_URL);
            Ok(())
        })
        .on_page_load(move |window, _| {
            // let window = app.get_webview_window("setup").unwrap();
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
