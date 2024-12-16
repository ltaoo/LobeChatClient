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
function fetchEnvOfLanguageOrSDK(lines) {
  console.log("fetchEnvOfLanguageOrSDK", lines);
  const env = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    (() => {
      if (line.includes("deno -v")) {
        const next_line1 = lines[i + 1];
        const next_line2 = lines[i + 2];
        const regex = /deno ([0-9.]{1,})/;
        const m1 = next_line1 && next_line1.match(regex);
        if (m1) {
          env["deno"] = {
            version: m1[1],
          };
          return;
        }
        const m2 = next_line2 && next_line2.match(regex);
        if (m2) {
          env["deno"] = {
            version: m2[1],
          };
          return;
        }
      }
    })();
  }
  return env;
}

async function checkENV() {
  await execute(`deno -v\r`);
  // await execute(`pnpm -v\r`);
  // await execute(`yarn -v\r`);
  // await execute(`npm -v\r`);
  // await execute(`git -v\r`);
}
async function cloneLobeChatRepo(config) {
  console.log("start cloneLobeChatRepo", config.app_dir);
  await execute(`cd ${config.app_dir}\r`);
  await execute(
    `git clone ${config.github_proxy_url}/${config.lobe_chat_repo_url} --depth 1\r`
  );
  await execute(`cd ${config.lobe_chat_repo_dir_name}\r`);
  await execute(`pwd\r`);
}
async function installDependencies(config, state) {
  await execute(`cd ${config.lobe_chat_repo_dir}\r`);
  // @todo 判断 macos
  await execute(`$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = 0\r`);
  await execute(
    `$env:COREPACK_NPM_REGISTRY = "https://registry.npmmirror.com"\r`
  );
  await execute(`corepack enable\r`);
  if (state.env !== undefined && state.env.pnpm !== undefined) {
    await execute(`$env:PNPM_DISTURL = "https://npmmirror.com/dist"\r`);
    await execute(`pnpm i --registry=${config.npm_register_mirror_url}\r`);
    return;
  }
  // if (state.env !== undefined && state.env.yarn !== undefined) {
  //   await execute(`yarn i --registry=${config.npm_register_mirror_url}\r`);
  //   return;
  // }
  await execute(`npm i --registry=${config.npm_register_mirror_url}\r`);
}
async function buildLobeChat(config, state) {
  await execute(`cd ${config.lobe_chat_repo_dir}\r`);
  await execute(`$env:NODE_ENV = "production"\r`);
  await execute(`$env:DOCKER = "true"\r`);
  await execute(`npm run build\r`);
}
async function startLobeChatServer(config, state) {
  await execute(`cd ${config.lobe_chat_repo_dir}\r`);
  await execute(`deno run --allow-all server.cjs\r`);
  await execute("set_complete", { task: "frontend" });
}
async function checkExistingBuildDir() {}

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
  const handle_output = debounce(800, async () => {
    // let end = buf.cursorY;
    // console.log("read line from", state.cur_line, "to", end, buf._buffer.lines.isFull);
    // for (let i = state.cur_line; i < end; i += 1) {
    //   const text = buf.getLine(i)?.translateToString();
    //   lines.push(text);
    // }
    // state.cur_line = end;
    if (state.step === 0) {
      const buf = term.buffer.active;
      const end = buf.cursorY;
      const lines = getTermLines([state.cur_line, end]);
      state.cur_line = end;
      const env = fetchEnvOfLanguageOrSDK(lines);
      console.log(env);
      state.env = env;
      if (state.env === undefined) {
        return;
      }
      if (state.env["git"] === undefined) {
        return;
      }
      state.initial = true;
      if (config.lobe_chat_repo_dir === undefined) {
        state.step = 1;
        cloneLobeChatRepo(config, state);
        return;
      }
      if (config.lobe_chat_build_dir === undefined) {
        state.step = 2;
        installDependencies(config, state);
        return;
      }
      state.step = 4;
      startLobeChatServer(config, state);
      return;
    }
    if (state.step === 1) {
      const buf = term.buffer.active;
      const end = buf.cursorY;
      const lines = getTermLines([state.cur_line, end]);
      state.cur_line = end;
      const str_lines = lines.map((l) => l.trim()).filter(Boolean);
      const line = str_lines[str_lines.length - 2];
      console.log(
        "1. check the lobe-repo is cloned success.",
        line,
        str_lines,
        term.buffer.active.cursorY,
        term.buffer.active.length
      );
      if (line === undefined) {
        return;
      }
      const regex = new RegExp(`${config.lobe_chat_repo_dir_name}$`);
      if (line.match(regex)) {
        state.step = 2;
        installDependencies(config, state);
      }
      return;
    }
    if (state.step === 2) {
      const buf = term.buffer.active;
      // const end1 = buf.cursorY;
      const end2 = buf.length - 1;
      const lines = getTermLines([state.cur_line, end2]);
      state.cur_line = end2;
      const str_lines = lines.map((l) => l.trim()).filter(Boolean);
      const line1 = str_lines[str_lines.length - 1];
      const line2 = str_lines[str_lines.length - 2];
      console.log(
        "2. check the dependencies of lobe-chat is installed.",
        line1,
        str_lines,
        term.buffer.active.cursorY,
        term.buffer.active.length
      );
      if (line1 && line1.match(/Done in [0-9.]{1,}m{0,1}s/)) {
        state.step = 3;
        // console.log("install dependencies is ok, then build");
        buildLobeChat(config, state);
        return;
      }
      if (line2 && line2.match(/Done in [0-9.]{1,}m{0,1}s/)) {
        state.step = 3;
        // console.log("install dependencies is ok, then build");
        buildLobeChat(config, state);
        return;
      }
      return;
    }
    if (state.step == 3) {
      const buf = term.buffer.active;
      const end2 = buf.length - 1;
      const lines = getTermLines([state.cur_line, end2]);
      state.cur_line = end2;
      const str_lines = lines.map((l) => l.trim()).filter(Boolean);
      const line = str_lines[str_lines.length - 1];
      console.log(
        "3. check the lobe-chat is builded.",
        line,
        str_lines,
        term.buffer.active.cursorY,
        term.buffer.active.length
      );
      if (line === undefined) {
        return;
      }
      if (line.match(/^🟢/)) {
        state.step = 4;
        startLobeChatServer(config, state);
        return;
      }
      return;
    }
    if (state.step === 4) {
      const buf = term.buffer.active;
      const end2 = buf.length - 1;
      const lines = getTermLines([state.cur_line, end2]);
      state.cur_line = end2;
      const str_lines = lines.map((l) => l.trim()).filter(Boolean);
      console.log(
        "4. check the lobe-chat server is running.",
        str_lines,
        term.buffer.active.cursorY,
        term.buffer.active.length
      );
      if (str_lines.length === 0) {
        return;
      }
      const regex = /Local: {1,}(http[a-z0-9://]{1,})/;
      let url = (() => {
        const matched = str_lines.find((line) => {
          return line.match(regex);
        });
        if (matched === null) {
          return null;
        }
        return matched.match(regex)[1];
      })();
      if (url === null) {
        url = `http://localhost:${config.lobe_chat_server_port}`;
      }
      let ready = str_lines.find((line) => {
        return line.match(/Ready in [0-9]{1,}ms/);
      });
      if (ready === undefined) {
        return;
      }
      console.log("redirect to lobe-chat page", url);
      window.location.href = url;
    }
  });
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
