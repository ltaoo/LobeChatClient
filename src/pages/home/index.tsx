/**
 * @file 首页
 */
import { createSignal, onCleanup, onMount } from "solid-js";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { ViewComponent, ViewComponentProps } from "@/store/types";
import { base, Handler } from "@/domains/base";
import { RequestCore } from "@/domains/request";
import { execute } from "@/biz/requests";
import {
  downloadDeno,
  downloadLobeChatBundle,
  fetchSetupConfig,
  resizePTYWindowSize,
  showLobeChatWindow,
  startPTY,
} from "@/biz/services";
import { debounce } from "@/utils/lodash/debounce";
import { sleep } from "@/utils";

function HomeIndexPageCore(props: ViewComponentProps) {
  const { app } = props;

  const requests = {
    /** 获取初始化信息 */
    fetchSetupConfig: new RequestCore(fetchSetupConfig),
    /** 启动一个终端 */
    startPTY: new RequestCore(startPTY),
    /** 调整终端宽高 */
    resizePTY: new RequestCore(resizePTYWindowSize),
    /** 下载 deno 作为 lobe-chat 的运行时 */
    downloadDeno: new RequestCore(downloadDeno),
    /** 下载打包好的 LobeChat 文件 */
    downloadLobeChat: new RequestCore(downloadLobeChatBundle),
    /** 展示 LobeChat 窗口 */
    showLobeChat: new RequestCore(showLobeChatWindow),
  };
  const _pty_state = {
    initial: false,
    range_start: 0,
    range_end: 0,
    step: 0,
    error_count: 0,
    lines: [],
  };
  const _config: Partial<{
    bin_path: string;
    lobe_chat_path: string;
    // app_dir: string;
    // lobe_chat_repo_dir: string;
    // lobe_chat_build_dir: string;
    // lobe_chat_repo_url: string;
    // lobe_chat_repo_dir_name: string;
    // lobe_chat_server_port: string;
    // github_proxy_url: string;
    // npm_register_mirror_url: string;
  }> = {};
  /** 终端输出 */
  const _messages: string[] = [];
  // @ts-ignore
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
    scrollback: 0,
    scrollOnUserInput: false,
    // scrollSensitivity: 1,
    cols: 120,
    rows: 30,
  });
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(new CanvasAddon());
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  function getTermLines(messages: string[], range: number[]) {
    const lines: string[] = [];
    for (let i = range[0]; i < range[1] + 1; i += 1) {
      const text = messages[i];
      if (text) {
        lines.push(text);
      }
    }
    return lines;
  }
  async function startLobeChatServer(config: { lobe_chat_path: string; bin_path: string }) {
    // console.log("[PAGE]home/index - startLobeChatServer", _config.lobe_chat_build_dir);
    await execute(`cd ${config.lobe_chat_path}\r`);
    await execute(`${config.bin_path} run --allow-all server.cjs\r`);
    _pty_state.step = 4;
  }
  const handle_output = debounce(800, async () => {
    if (_pty_state.step === 0) {
      _pty_state.range_end = _messages.length - 1;
      const lines = getTermLines(_messages, [_pty_state.range_start, _pty_state.range_end]);
      _pty_state.range_start = _pty_state.range_end;
      const env: { deno?: { version: string } } = {};
      const latest_line = lines[lines.length - 2];
      const regex = /deno ([0-9.]{1,})/;
      const m1 = latest_line && latest_line.match(regex);
      if (m1) {
        env["deno"] = {
          version: m1[1],
        };
      }
      if (!env["deno"] && _pty_state.error_count < 3) {
        // _pty_state.error_count += 1;
        _pty_state.step = 1;
        // await requests.downloadDeno.run();
        return;
      }
      _pty_state.initial = true;
      if (_config.lobe_chat_path === undefined) {
        _pty_state.step = 2;
        const r = await requests.downloadLobeChat.run({
          url: "https://ghp.ci/https://github.com/ltaoo/LobeChatClient/releases/download/v1.36.11/lobe-chat_v1.36.11.zip",
          path: "lobe-chat_v1.36.11.zip",
        });
        if (r.error) {
          app.tip({
            text: [r.error.message],
          });
          return;
        }
        return;
      }
      _pty_state.step = 4;
      // startLobeChatServer();
      return;
    }
    if (_pty_state.step === 1) {
      _pty_state.range_end = _messages.length - 1;
      const lines = getTermLines(_messages, [_pty_state.range_start, _pty_state.range_end]);
      _pty_state.range_start = _pty_state.range_end;
      const line = lines[lines.length - 1];
      if (line.includes("Deno was installed successfully")) {
        _pty_state.step = 2;
        return;
      }
      return;
    }
    if (_pty_state.step === 2) {
      _pty_state.range_end = _messages.length - 1;
      const lines = getTermLines(_messages, [_pty_state.range_start, _pty_state.range_end]);
      _pty_state.range_start = _pty_state.range_end;
      const line = lines[lines.length - 1];
      if (line.includes("unzip lobe-chat success")) {
        _pty_state.step = 4;
        return;
      }
      // const str_lines = lines.map((l) => l.trim()).filter(Boolean);
      // const line1 = str_lines[str_lines.length - 1];
      // if (line1 && line1.match(/Done in [0-9.]{1,}m{0,1}s/)) {
      //   _pty_state.step = 4;
      //   return;
      // }
      return;
    }
    if (_pty_state.step === 4) {
      _pty_state.range_end = _messages.length - 1;
      const lines = getTermLines(_messages, [_pty_state.range_start, _pty_state.range_end]);
      _pty_state.range_start = _pty_state.range_end;
      const str_lines = lines.map((l) => l.trim()).filter(Boolean);
      if (str_lines.length === 0) {
        return;
      }
      const regex = /Local: {1,}(http[a-z0-9://]{1,})/;
      let url = (() => {
        const matched = str_lines.find((line) => {
          return line.match(regex);
        });
        if (!matched) {
          return null;
        }
        const m2 = matched.match(regex);
        if (m2) {
          return m2[1];
        }
        return null;
      })();
      if (!url) {
        return;
      }
      // requests.showLobeChat.run({ url });
      const setup = getCurrentWebviewWindow();
      setup.hide();
      setTimeout(() => {
        setup.close();
      }, 1000);
      const webview = new WebviewWindow("main", {
        title: "LobeChatClient",
        width: 1200,
        height: 80,
        url,
      });
      webview.show();
    }
  });
  const state = {};

  enum Events {
    Change,
  }
  type TheTypesOfEvents = {
    [Events.Change]: typeof state;
  };
  const bus = base<TheTypesOfEvents>();
  function numbersToChars(arr: Uint8Array) {
    // @ts-ignore
    return arr.map((num) => {
      return String.fromCharCode(num);
    });
  }
  listen<Uint8Array>("data", (event) => {
    const message = event.payload;
    const msg = numbersToChars(message).join("");
    const lines = msg.split("↵");
    console.log(msg);
    _messages.push(...lines);
    term.write(message);
    term.scrollToBottom();
    handle_output();
  });
  listen<{ bin_path: string }>("can_download_lobe_chat", async (event) => {
    console.log("[PAGE]home/index - can_download_lobe_chat", event.payload);
    Object.assign(_config, event.payload);
    await requests.downloadLobeChat.run({
      url: "https://ghp.ci/https://github.com/ltaoo/LobeChatClient/releases/download/v1.36.11/lobe-chat_v1.36.11.zip",
      path: "lobe-chat_v1.36.11.zip",
    });
  });
  listen<{ lobe_chat_path: string }>("can_start_lobe_chat_server", async (event) => {
    console.log("[PAGE]home/index - can_start_lobe_chat_server", event.payload);
    // const { lobe_chat_path } = event.payload;
    Object.assign(_config, event.payload);
    if (!_config.lobe_chat_path || !_config.bin_path) {
      app.tip({
        text: ["缺少"],
      });
      return;
    }
    startLobeChatServer({
      bin_path: _config.bin_path,
      lobe_chat_path: _config.lobe_chat_path,
    });
  });
  listen("tauri://close-requested", (event) => {
    execute("\x03");
    term.dispose();
  });

  return {
    state,
    ui: {},
    async ready() {
      const $term = document.getElementById("terminal");
      if (!$term) {
        return;
      }
      term.open($term);
      const r = await requests.startPTY.run();
      if (r.error) {
        app.tip({
          text: ["启动终端失败", r.error.message],
        });
        return;
      }
      await sleep(800);
      fitAddon.fit();
      const r2 = await requests.resizePTY.run({
        rows: term.rows,
        cols: term.cols,
      });
      if (r2.error) {
        app.tip({
          text: [r2.error.message],
        });
        return;
      }
      const r3 = await requests.fetchSetupConfig.run();
      if (r3.error) {
        app.tip({
          text: ["获取初始化信息失败", r3.error.message],
        });
        return;
      }
      if (!r3.data.deno_existing) {
        const r4 = await requests.downloadDeno.run();
        if (r4.error) {
          app.tip({
            text: ["下载 deno 失败", r4.error.message],
          });
          return;
        }
        return;
      }
      if (!r3.data.lobe_chat_dir) {
        const r4 = await requests.downloadLobeChat.run({
          url: "https://ghp.ci/https://github.com/ltaoo/LobeChatClient/releases/download/v1.36.11/lobe-chat_v1.36.11.zip",
          path: "lobe-chat_v1.36.11.zip",
        });
        if (r4.error) {
          app.tip({
            text: ["下载 LobeChat 失败", r4.error.message],
          });
          return;
        }
        return;
      }
      startLobeChatServer({
        bin_path: r3.data.deno_bin,
        lobe_chat_path: r3.data.lobe_chat_dir,
      });
    },
    destroy() {
      execute("\x03");
      term.dispose();
    },
    onChange(handler: Handler<TheTypesOfEvents[Events.Change]>) {
      return bus.on(Events.Change, handler);
    },
  };
}

export const HomeIndexPage: ViewComponent = (props) => {
  const $page = HomeIndexPageCore(props);

  const [state, setState] = createSignal($page.state);

  $page.onChange((v) => setState(v));

  onMount(() => {
    $page.ready();
  });
  onCleanup(() => {
    $page.destroy();
  });

  return (
    <div class="overflow-hidden min-h-screen relative flex flex-col bg-black rounded-md">
      <div data-tauri-drag-region class="absolute z-20 top-0 h-[48px] w-full ">
        <div
          class="absolute top-[10px] right-[12px] w-[36px] h-[36px] cursor-pointer"
          id=""
          onClick={() => {
            const win = getCurrentWindow();
            win.close();
          }}
        >
          <div class="w-full h-full text-gray-500 hover:text-gray-300">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z"
              />
            </svg>
          </div>
        </div>
      </div>
      <div class="absolute z-10 inset-0"></div>
      <div class="absolute z-0 top-0 bottom-0 w-full p-4">
        <div id="terminal" class="w-full h-full"></div>
        <div class="absolute top-0 w-full h-[68px] bg-gradient-to-b from-black to-transparent"></div>
        <div class="absolute bottom-0 w-full h-[68px] bg-gradient-to-t from-black to-transparent"></div>
      </div>
    </div>
  );
};
