const { invoke } = window.__TAURI__.core;

let lobeChatServerFailed = false;
function sleep(delay = 3000) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, delay);
  });
}
function debounce(wait, func) {
  let timeoutId;
  return function debounced(...args) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, wait);
  };
}

async function fetch(command, params) {
  return new Promise(async (resolve) => {
    try {
      const r = await invoke(command, params);
      return resolve([r, null]);
    } catch (err) {
      return resolve([null, err]);
    }
  });
}
async function execute(params) {
  return fetch("write_to_pty", { data: params });
}
async function greet() {
  // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  greetMsgEl.textContent = await invoke("greet", { name: greetInputEl.value });
}


window.addEventListener("DOMContentLoaded", async () => {
  const { load } = window.__TAURI__.store;
  const store = await load("store.json", { autoSave: false });

  const lobe_chat_repo_dir = await store.get("lobe_chat_repo_dir");
  const lobe_chat_build_dir = await store.get("lobe_chat_build_dir");
  const app_dir = await store.get("app_dir");
  const lobe_chat_server_port = await store.get("lobe_chat_server_port");
  const github_proxy_url = await store.get("github_proxy_url");
  const lobe_chat_repo_url = await store.get("lobe_chat_repo_url");
  const npm_register_mirror_url = await store.get("npm_register_mirror_url");
  const config = {
    app_dir,
    lobe_chat_repo_dir,
    lobe_chat_build_dir,
    lobe_chat_repo_url,
    lobe_chat_server_port,
    github_proxy_url,
    npm_register_mirror_url,
  };
  config.lobe_chat_repo_dir_name = config.lobe_chat_repo_url.split("/").pop();
  console.log("config", config);

  const term = new Terminal({
    fontFamily: [
      "Noto Mono for Powerline",
      "Roboto Mono for Powerline",
      "Jetbrains Mono",
      "Menlo",
      "Monaco",
      "Consolas",
      "Liberation Mono",
      "Courier New",
      "Noto Sans Mono CJK SC",
      "Noto Sans Mono CJK TC",
      "Noto Sans Mono CJK KR",
      "Noto Sans Mono CJK JP",
      "Noto Sans Mono CJK HK",
      "Noto Color Emoji",
      "Noto Sans Symbols",
      "monospace",
      "sans-serif",
    ].join(","),
    convertEol: true,
    cursorWidth: 2,
    allowProposedApi: false,
    tabStopWidth: 4,
    smoothScrollDuration: 0,
    scrollback: 80,
    scrollOnUserInput: true,
    scrollSensitivity: 1,
    cols: 120,
    rows: 30,
  });
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.loadAddon(new CanvasAddon.CanvasAddon());
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById("terminal"));
  term.onData((data) => {
    execute(data);
  });
  window.__term = term;
  const state = {
    initial: false,
    cur_line: 0,
    step: 0,
    lines: [],
  };
  function getTermLines(range) {
    const lines = [];
    for (let i = range[0]; i < range[1]; i += 1) {
      const text = term.buffer.active.getLine(i)?.translateToString();
      lines.push(text);
    }
    return lines;
  }
 
  window.__TAURI__.event.listen("data", (event) => {
    // console.log("handle data", event);
    const message = event.payload;
    term.write(message);
    term.scrollToBottom();
    handle_output();
  });
  window.__TAURI__.event.listen("tauri://close-requested", (event) => {
    execute("\x03");
    term.dispose();
  });
  window.addEventListener("beforeunload", (event) => {
    term.dispose();
  });
  await fetch("async_shell", {});
  await sleep(800);
  fitAddon.fit();
  await fetch("resize_pty", {
    rows: term.rows,
    cols: term.cols,
  });
  const r = await fetch("download_file", {
    url: "https://github.com/denoland/deno/releases/download/v2.1.4/deno-aarch64-apple-darwin.zip",
    savePath: "deno-aarch64-apple-darwin.zip",
  });
  console.log(r);
  if (config.lobe_chat_build_dir === undefined) {
    await checkENV();
    return;
  }
  state.step = 4;
  await startLobeChatServer(config, state);
});
