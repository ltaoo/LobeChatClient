use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{self, Path, PathBuf};
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
use tauri::window;
use tauri::PhysicalSize;
use tauri::Size;
#[allow(unused)]
use tauri::{App, Emitter, Listener, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindow};
use tauri_plugin_store::StoreExt;
use thiserror;
use zip::ZipArchive;

struct AppState {
    /** 系统架构,用于下载 deno */
    pub os_target: String,
    /**
     * 应用目录
     * windows 在 ~/AppData/Roaming/com.lobe-chat-client.app  macOS 在 ~/.lobe_chat
     * 用于存放 LobeChat 打包文件以及配置文件
     */
    pub document_dir: PathBuf,
    /** deno 二进制文件路径 */
    pub deno_bin: PathBuf,
    /** 需要下载的 deno 压缩包文件路径 */
    pub downloading_deno_zip: PathBuf,
    /** 下载的 deno 版本 仅用于下载 */
    pub deno_version: String,
    /** deno 是否存在 */
    pub deno_existing: bool,
    /** LobeChat 打包产物下载地址 */
    pub lobe_chat_zip_url: String,
    /** LobeChat 打包产物文件夹 */
    pub lobe_chat_dir: PathBuf,
    /** LobeChat 打包产物是否存在 */
    pub lobe_chat_existing: bool,
    /** 需要下载的 LobeChat 压缩包文件路径 */
    pub downloading_lobe_chat_zip: PathBuf,
    /**  是否正在下载 deno */
    pub is_downloading_deno: bool,
    /** 是否正在下载 lobe chat  */
    pub is_downloading_lobe_chat: bool,
    /** pty 是否已初始化 */
    pub pty_existing: bool,
    /** pty */
    pub pty_pair: tauri::async_runtime::Mutex<PtyPair>,
    // 向 pty 写入命令
    pub writer: tauri::async_runtime::Mutex<Box<dyn io::Write + Send>>,
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
    let application_dir: PathBuf = document_dir.to_path_buf().join(".lobe_chat_client");
    if !fs::metadata(application_dir.clone()).is_ok() {
        fs::create_dir_all(application_dir.clone());
    }
    application_dir
}
fn is_directory_exists(dir: &PathBuf) -> bool {
    fs::metadata(&dir)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}
fn get_file_parent_directory(dir: &PathBuf) -> Option<PathBuf> {
    dir.parent().map(|p| p.to_path_buf())
}

fn extract_zip(zip_path: &PathBuf, output_folder: &PathBuf) -> Result<String, String> {
    let zip_file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(zip_file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let out_path = path::Path::new(&output_folder).join(file.sanitized_name());

        // 确保输出目录存在
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // 解压文件
        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    return Ok(format!("ok"));
}

async fn download_deno(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<tokio::sync::Mutex<AppState>>();
    let mut state = state.lock().await;

    let deno_version = &state.deno_version;
    let target = &state.os_target;
    let deno_bin_filepath = PathBuf::from(&state.deno_bin);
    // https://github.com/denoland/deno/releases/download/v2.1.4/deno-aarch64-apple-darwin.zip
    let deno_uri = format!(
        "https://ghp.ci/https://github.com/denoland/deno/releases/download/v{}/deno-{}.zip",
        deno_version, target
    );
    let deno_zip_filepath = PathBuf::from(&state.downloading_deno_zip);
    if !deno_zip_filepath.exists() {
        window.emit(
            "deno_download_start",
            json!({
                "uri": &deno_uri,
                "target": deno_zip_filepath.display().to_string(),
            }),
        );
        state.is_downloading_deno = true;
        let client = Client::new();
        let mut response = client.get(&deno_uri).send().await?;
        if !response.status().is_success() {
            window.emit(
                "deno_download_failed",
                json!({ "reason": "request failed", "url": &deno_uri, "filepath": &deno_zip_filepath.display().to_string() }),
            );
            return Ok(());
        }
        let mut file = fs::File::create(&deno_zip_filepath).expect("Unable to create file");
        let mut writer = io::BufWriter::new(file);
        let mut downloaded: u64 = 0;
        let total_size = response
            .content_length()
            .ok_or("Could not get content length")?;

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            downloaded += chunk.len() as u64;
            writer.write_all(&chunk)?;
            let percentage = downloaded as f64 / total_size as f64 * 100.0;
            // let msg = format!("Download progress: {:.2}%", percentage);
            window.emit("deno_download_percent", json!({ "percent": percentage }));
        }
        writer.flush()?;
        state.is_downloading_deno = false;
    }
    if !deno_bin_filepath.exists() {
        window.emit(
            "unzip_deno",
            json!({"file": &deno_zip_filepath.display().to_string()}),
        );
        let mut archive =
            ZipArchive::new(fs::File::open(&deno_zip_filepath).expect("Failed to open ZIP file"))
                .unwrap();
        let r = archive.extract(&deno_bin_filepath.parent().unwrap());
        // let r = extract_zip(&deno_zip_filepath, &deno_bin_filepath);
        if r.is_err() {
            fs::remove_file(&deno_zip_filepath);
            window.emit("deno_download_failed", json!({ "reason": "unzip failed", "filepath": &deno_zip_filepath.display().to_string() }));
            return Ok(());
        }
        // fs::remove_file(zip_path).expect("Failed to delete ZIP file");
        Command::new("chmod")
            .arg("+x")
            .arg(&deno_bin_filepath)
            .output()
            .unwrap();
        window.set_focus();
    }
    window.emit(
        "can_download_lobe_chat",
        json!({"bin_path": deno_bin_filepath.display().to_string()}),
    );
    return Ok(());
}

async fn download_zip_file_then_unzip(
    url: String,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<tokio::sync::Mutex<AppState>>();
    let mut state = state.lock().await;
    // println!("_download file from {} to {:?}", url, filepath);
    let lobe_chat_zip_filepath = PathBuf::from(&state.downloading_lobe_chat_zip);
    if !lobe_chat_zip_filepath.exists() {
        window.emit(
            "lobe_chat_download_start",
            json!({"uri": url, "target": lobe_chat_zip_filepath}),
        );
        let client = Client::new();
        state.is_downloading_lobe_chat = true;
        let mut response = client.get(url).send().await?;
        if !response.status().is_success() {
            // println!("Failed to download file: {}", response.status());
            window.emit(
                "lobe_chat_download_failed",
                json!({"reason": "request failed", "filepath": &lobe_chat_zip_filepath.display().to_string() }),
            );
            return Ok(());
        }
        let mut downloaded: u64 = 0;
        let file = fs::File::create(&lobe_chat_zip_filepath)?;
        let mut writer = io::BufWriter::new(file);
        let total_size = response
            .content_length()
            .ok_or("Could not get content length")?;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            downloaded += chunk.len() as u64;
            writer.write_all(&chunk)?;
            let percentage = downloaded as f64 / total_size as f64 * 100.0;
            // let msg = format!("Download progress: {:.2}%", percentage);
            window.emit(
                "lobe_chat_download_percent",
                json!({ "percent": percentage }),
            );
        }
        writer.flush()?;
        state.is_downloading_lobe_chat = false;
    }
    let lobe_chat_dir = &state.lobe_chat_dir;
    if !lobe_chat_dir.exists() {
        window.emit(
            "unzip_lobe_chat",
            json!({ "file": &lobe_chat_zip_filepath.display().to_string() }),
        );
        let r = extract_zip(&lobe_chat_zip_filepath, &lobe_chat_dir);
        if r.is_err() {
            fs::remove_file(&lobe_chat_zip_filepath);
            window.emit(
                "lobe_chat_download_failed",
                json!({ "reason": "unzip failed", "filepath": &lobe_chat_zip_filepath.display().to_string() }),
            );
            return Ok(());
        }
    }
    window.emit(
        "can_start_lobe_chat_server",
        json!({"lobe_chat_path": &lobe_chat_dir.display().to_string()}),
    );
    return Ok(());
}

#[tauri::command]
async fn download_lobe_chat(
    state: tauri::State<'_, tokio::sync::Mutex<AppState>>,
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, Error> {
    let state = state.lock().await;
    let cloned_app = app.clone();
    let cloned_window = window.clone();
    let url_clone = state.lobe_chat_zip_url.clone();
    thread::spawn(move || {
        let _ = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(download_zip_file_then_unzip(
                url_clone,
                cloned_app,
                cloned_window,
            ));
    });
    return Ok(json!({
        "code": 0,
        "msg": "start download file",
        "data": None::<String>,
    }));
}

#[tauri::command]
async fn start_pty(
    state: tauri::State<'_, tokio::sync::Mutex<AppState>>,
) -> Result<serde_json::Value, String> {
    let mut state = state.lock().await;
    if state.pty_existing == true {
        return Ok(json!({
            "code": 0,
            "msg": "",
            "data": serde_json::Value::Null,
        }));
    }

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
    state.pty_existing = true;

    thread::spawn(move || {
        let status = child.wait().unwrap();
        exit(status.exit_code() as i32)
    });

    return Ok(json!({
        "code": 0,
        "msg": "",
        "data": serde_json::Value::Null,
    }));
}

#[tauri::command]
async fn write_to_pty(
    data: String,
    state: tauri::State<'_, tokio::sync::Mutex<AppState>>,
) -> Result<(), ()> {
    let state = state.lock().await;
    let mut w = state.writer.lock().await;
    write!(w, "{}", data).map_err(|_| ());
    return Ok(());
}

#[tauri::command]
async fn resize_pty(
    rows: u16,
    cols: u16,
    state: tauri::State<'_, tokio::sync::Mutex<AppState>>,
) -> Result<serde_json::Value, ()> {
    let state = state.lock().await;

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
    }));
}

#[tauri::command]
fn show_main_window(url: String, app: tauri::AppHandle) -> Result<serde_json::Value, ()> {
    // println!("show main window with url {}", url);
    let setup_window = app.get_webview_window("setup").unwrap();
    setup_window.close().unwrap();

    let main_window = WebviewWindow::builder(&app, "main", tauri::WebviewUrl::App(url.into()))
        .build()
        .unwrap();
    main_window.set_size(PhysicalSize::new(1280, 880));
    main_window.set_title("LobeChatClient");
    main_window.show();

    // let main_window = WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App(url.into())).build().unwrap();
    // main_window.show();

    // thread::spawn(move || {
    //     let _ = tokio::runtime::Runtime::new().unwrap().block_on(show_main_window(app_clone, url));
    // });
    // return Ok(());
    return Ok(json!({
        "code": 0,
        "msg": "",
        "data": serde_json::Value::Null,
    }));
}

#[tauri::command]
fn download_deno_then_enable(
    app: tauri::AppHandle,
    state: tauri::State<'_, tokio::sync::Mutex<AppState>>,
) -> Result<serde_json::Value, ()> {
    let window = app.get_webview_window("setup").unwrap();
    let cloned_app = app.clone();
    let cloned_window = window.clone();
    thread::spawn(move || {
        let _ = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(download_deno(cloned_app, cloned_window));
    });
    return Ok(json!({
        "code": 0,
        "msg": "",
        "data": serde_json::Value::Null,
    }));
}

#[tauri::command]
async fn fetch_setup_config(
    state: tauri::State<'_, tokio::sync::Mutex<AppState>>,
) -> Result<serde_json::Value, ()> {
    let state = state.lock().await;
    return Ok(json!({
        "code": 0,
        "msg": "",
        "data": json!({
            "deno_bin": state.deno_bin,
            "deno_existing": state.deno_existing,
            "lobe_chat_dir": state.lobe_chat_dir,
            "lobe_chat_existing": state.lobe_chat_existing,
        }),
    }));
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

    let reader = Arc::new(Mutex::new(Some(io::BufReader::new(reader))));
    let output = Arc::new(Mutex::new(String::new()));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            fetch_setup_config,
            start_pty,
            resize_pty,
            write_to_pty,
            download_deno_then_enable,
            download_lobe_chat,
            show_main_window,
        ])
        .setup(move |app| {
            let document_dir = get_document_dir();
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
            let deno_dir = format!("{}/.deno", dirs::home_dir().unwrap().display());
            let deno_bin_dir = PathBuf::from(&deno_dir).join("bin");
            let deno_bin_path = deno_bin_dir.join("deno");
            let deno_bin_existing = deno_bin_path.exists();
            let deno_version = String::from("2.1.4");
            let deno_filename = format!("deno-{}-{}.zip", deno_version, target);
            let deno_zip_filepath = PathBuf::from(&document_dir).join(deno_filename);

            let lobe_build_dir = document_dir.join("lobe-chat_v1.36.11");
            let lobe_chat_zip = document_dir.join("lobe-chat_v1.36.11.zip");
            let lobe_chat_zip_url =  format!("{}https://github.com/ltaoo/LobeChatClient/releases/download/v1.36.11/lobe-chat_v1.36.11.zip", "https://ghp.ci/");
            let lobe_build_dir_existing = lobe_build_dir.exists();

            fs::create_dir_all(&deno_dir).unwrap();
            fs::create_dir_all(&deno_bin_dir).unwrap();
            fs::create_dir_all(&document_dir).unwrap();

            let state = tokio::sync::Mutex::new(AppState {
                os_target: String::from(target),
                document_dir: document_dir,
                deno_bin: deno_bin_path,
                deno_version: deno_version,
                deno_existing: deno_bin_existing,
                downloading_deno_zip: deno_zip_filepath,
                lobe_chat_zip_url,
                lobe_chat_existing: lobe_build_dir_existing,
                lobe_chat_dir: lobe_build_dir,
                downloading_lobe_chat_zip: lobe_chat_zip,
                is_downloading_deno: false,
                is_downloading_lobe_chat: false,
                pty_existing: false,
                pty_pair: tauri::async_runtime::Mutex::new(pty_pair),
                writer: tauri::async_runtime::Mutex::new(writer),
            });
            app.manage(state);
            return Ok(());
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
                            window.emit("term_data", data).unwrap();
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
                async {
                    // println!("closing window...");
                    let state = _app_handle.state::<tokio::sync::Mutex<AppState>>();
                    let state = state.lock().await;
                    if state.is_downloading_deno == true {
                        // let file = fs::File::open(&deno_zip_filepath).unwrap();
                        fs::remove_file(&state.deno_bin).expect("Failed to delete ZIP file");
                    }
                    if state.is_downloading_lobe_chat == true {
                        // let file = fs::File::open(&deno_zip_filepath).unwrap();
                        fs::remove_file(&state.downloading_lobe_chat_zip)
                            .expect("Failed to delete ZIP file");
                    }
                    // run the window destroy manually just for fun :)
                    // usually you'd show a dialog here to ask for confirmation or whatever
                    // let app_state = _app_handle.emit("window-close", {});
                    // _app_handle
                    //     .get_webview_window(label)
                    //     .unwrap()
                    //     .destroy()
                    //     .unwrap();
                    return ();
                }
            }
            _ => {
                return ();
            }
        };
    });
}
