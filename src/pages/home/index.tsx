/**
 * @file 首页
 */
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
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
import { Check, Info, Loader } from "lucide-solid";

enum LobeChatSteps {
  CheckDenoExisting,
  InstallDeno,
  CheckLobeChatExisting,
  DownloadLobeChat,
  StartLobeChatServer,
  SetupFailed,
  InstallDenoFailed,
  DownloadLobeChatFailed,
  PrepareShowLobeChat,
}

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
  /** 启动 LobeChat 的阶段 */
  let _step = LobeChatSteps.CheckDenoExisting;
  let _deno = {
    existing: false,
    percent: 0,
    installed: false,
    messages: [] as string[],
    error: null as null | Error,
  };
  let _lobe_chat = {
    existing: false,
    percent: 0,
    downloaded: false,
    messages: [] as string[],
    error: null as null | Error,
  };
  let _server = {
    messages: [] as string[],
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
    rows: 24,
    cols: 80,
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
    bus.emit(Events.Change, { ..._state });
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
      _step = LobeChatSteps.PrepareShowLobeChat;
      bus.emit(Events.Change, { ..._state });
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
  const _state = {
    get step() {
      return _step;
    },
    get deno() {
      return _deno;
    },
    get lobe_chat() {
      return _lobe_chat;
    },
    get server() {
      return _server;
    },
  };

  enum Events {
    Change,
  }
  type TheTypesOfEvents = {
    [Events.Change]: typeof _state;
  };
  const bus = base<TheTypesOfEvents>();
  function numbersToChars(arr: Uint8Array) {
    // @ts-ignore
    return arr.map((num) => {
      return String.fromCharCode(num);
    });
  }
  listen<Uint8Array>("term_data", (event) => {
    if (_pty_state.step !== 4) {
      return;
    }
    const message = event.payload;
    const msg = numbersToChars(message).join("");
    console.log(msg);
    const lines = msg.split("↵");
    _messages.push(...lines);
    _server.messages.push(...lines);
    // term.write(message);
    // term.scrollToBottom();
    handle_output();
  });
  listen<{ uri: string; target: string }>("deno_download_start", (event) => {
    const data = event.payload;
    _deno.messages.push(`url: ${data.uri}`);
    _deno.messages.push(`download to: ${data.target}`);
    bus.emit(Events.Change, { ..._state });
  });
  listen<{ uri: string; target: string }>("lobe_chat_download_start", (event) => {
    const data = event.payload;
    _lobe_chat.messages.push(`url: ${data.uri}`);
    _lobe_chat.messages.push(`download to: ${data.target}`);
    bus.emit(Events.Change, { ..._state });
  });
  listen<{ bin_path: string }>("can_download_lobe_chat", async (event) => {
    console.log("[PAGE]home/index - can_download_lobe_chat", event.payload);
    Object.assign(_config, event.payload);
    _step = LobeChatSteps.DownloadLobeChat;
    _deno.existing = true;
    bus.emit(Events.Change, { ..._state });
    await requests.downloadLobeChat.run();
  });
  listen<{ lobe_chat_path: string }>("can_start_lobe_chat_server", async (event) => {
    console.log("[PAGE]home/index - can_start_lobe_chat_server", event.payload);
    _step = LobeChatSteps.StartLobeChatServer;
    _lobe_chat.existing = true;
    bus.emit(Events.Change, { ..._state });
    // const { lobe_chat_path } = event.payload;
    Object.assign(_config, event.payload);
    if (!_config.lobe_chat_path) {
      app.tip({
        text: ["缺少 lobe_chat 文件"],
      });
      return;
    }
    if (!_config.bin_path) {
      app.tip({
        text: ["缺少 deno 文件"],
      });
      return;
    }
    startLobeChatServer({
      bin_path: _config.bin_path,
      lobe_chat_path: _config.lobe_chat_path,
    });
  });
  listen<{ reason: string; filepath: string }>("deno_download_failed", (event) => {
    const data = event.payload;
    console.log("[PAGE]home/index - deno_download_failed", data);
    _step = LobeChatSteps.InstallDenoFailed;
    _deno.error = new Error(`${data.reason} - ${data.filepath}`);
    bus.emit(Events.Change, { ..._state });
  });
  listen<{ reason: string; filepath: string }>("lobe_chat_download_failed", (event) => {
    const data = event.payload;
    console.log("[PAGE]home/index - lobe_chat_download_failed", data);
    _step = LobeChatSteps.DownloadLobeChatFailed;
    _lobe_chat.error = new Error(`${data.reason} - ${data.filepath}`);
    bus.emit(Events.Change, { ..._state });
  });
  listen<{ percent: number }>("deno_download_percent", (event) => {
    const data = event.payload;
    _deno.percent = parseFloat(data.percent.toFixed(2));
    bus.emit(Events.Change, { ..._state });
  });
  listen<{ percent: number }>("lobe_chat_download_percent", (event) => {
    const data = event.payload;
    _lobe_chat.percent = parseFloat(data.percent.toFixed(2));
    bus.emit(Events.Change, { ..._state });
  });
  listen("tauri://close-requested", (event) => {
    execute("\x03");
    term.dispose();
  });

  return {
    state: _state,
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
      await requests.resizePTY.run({
        rows: term.rows,
        cols: term.cols,
      });
      const r3 = await requests.fetchSetupConfig.run();
      if (r3.error) {
        app.tip({
          text: ["获取初始化信息失败", r3.error.message],
        });
        _step = LobeChatSteps.SetupFailed;
        return;
      }
      console.log("[PAGE]home/index - setup config", r3.data);
      if (!r3.data.deno_existing) {
        _step = LobeChatSteps.InstallDeno;
        bus.emit(Events.Change, { ..._state });
        const r4 = await requests.downloadDeno.run();
        if (r4.error) {
          _step = LobeChatSteps.InstallDenoFailed;
          _deno.error = r4.error;
          bus.emit(Events.Change, { ..._state });
          app.tip({
            text: ["下载 deno 失败", r4.error.message],
          });
          return;
        }
        return;
      }
      _deno.existing = true;
      if (!r3.data.lobe_chat_existing) {
        _step = LobeChatSteps.DownloadLobeChat;
        bus.emit(Events.Change, { ..._state });
        const r4 = await requests.downloadLobeChat.run();
        if (r4.error) {
          _step = LobeChatSteps.DownloadLobeChatFailed;
          _lobe_chat.error = r4.error;
          bus.emit(Events.Change, { ..._state });
          return;
        }
        return;
      }
      _step = LobeChatSteps.StartLobeChatServer;
      _lobe_chat.existing = true;
      bus.emit(Events.Change, { ..._state });
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
      <div class="absolute z-10 inset-0">
        <div class="w-full h-full py-12 px-8 space-y-2">
          <Show when={state().step === LobeChatSteps.CheckDenoExisting}>
            <div class="flex items-center text-white space-x-4">
              <Loader class="w-4 h-4 animate animate-spin" />
              <div>Check environment</div>
            </div>
          </Show>
          <Show when={state().step === LobeChatSteps.InstallDeno}>
            <div class="flex text-white space-x-4">
              <Loader class="mt-1 w-4 h-4 animate animate-spin" />
              <div class="flex-1 flex flex-col">
                <div>Install deno</div>
                <div class="mt-2">
                  <For each={state().deno.messages}>
                    {(msg) => {
                      return <div class="break-all">{msg}</div>;
                    }}
                  </For>
                </div>
                <Show when={state().deno.percent !== 0}>
                  <div class="mt-2 flex items-center w-full h-[16px]">
                    <div class="h-full bg-green-500" style={{ width: `${state().deno.percent}%` }}></div>
                    <div class="ml-1 text-gray-200">{state().deno.percent}%</div>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
          <Show when={state().deno.existing}>
            <div class="flex items-center text-white space-x-4">
              <Check class="w-4 h-4 text-green-500" />
              <div class="flex space-x-2">
                <div>deno prepared</div>
              </div>
            </div>
          </Show>
          <Show when={state().deno.error}>
            <div class="flex text-white space-x-4">
              <Info class="mt-1 w-4 h-4 text-red-500" />
              <div class="flex-1 flex flex-col">
                <div>Install deno failed</div>
                <div class="break-all">{state().deno.error!.message}</div>
              </div>
            </div>
          </Show>
          <Show when={state().step === LobeChatSteps.DownloadLobeChat}>
            <div class="flex w-full text-white space-x-4">
              <Loader class="mt-1 w-4 h-4 animate animate-spin" />
              <div class="flex-1 flex flex-col">
                <div>Download LobeChat</div>
                <div class="mt-2">
                  <For each={state().lobe_chat.messages}>
                    {(msg) => {
                      return <div class="break-all">{msg}</div>;
                    }}
                  </For>
                </div>
                <Show when={state().lobe_chat.percent !== 0}>
                  <div class="mt-2 flex items-center w-full h-[16px]">
                    <div class="h-full bg-green-500" style={{ width: `${state().lobe_chat.percent}%` }}></div>
                    <div class="ml-1 text-gray-200">{state().lobe_chat.percent}%</div>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
          <Show when={state().lobe_chat.existing}>
            <div class="flex items-center text-white space-x-4">
              <Check class="w-4 h-4 text-green-500" />
              <div class="flex space-x-2">
                <div>LobeChat prepared</div>
              </div>
            </div>
          </Show>
          <Show when={state().lobe_chat.error}>
            <div class="flex text-white space-x-4">
              <Info class="mt-1 w-4 h-4 text-red-500" />
              <div class="flex-1 flex flex-col">
                <div>Download LobeChat failed</div>
                <div class="break-all">{state().lobe_chat.error!.message}</div>
              </div>
            </div>
          </Show>
          <Show when={state().step === LobeChatSteps.StartLobeChatServer}>
            <div class="flex w-full text-white space-x-4">
              <Loader class="mt-1 w-4 h-4 animate animate-spin" />
              <div class="flex-1 flex flex-col">
                <div>Start LobeChat server...</div>
                <div class="mt-2">
                  <For each={state().server.messages}>
                    {(msg) => {
                      return <div class="break-all">{msg}</div>;
                    }}
                  </For>
                </div>
              </div>
            </div>
          </Show>
          <Show when={state().step === LobeChatSteps.PrepareShowLobeChat}>
            <div class="flex items-center text-white space-x-4">
              <Check class="w-4 h-4 text-green-500" />
              <div class="flex items-center space-x-2">
                <div>LobeChat server is ok</div>
              </div>
            </div>
          </Show>
          <Show when={state().step === LobeChatSteps.SetupFailed}>
            <div class="flex items-center text-white space-x-4">
              <Info class="w-4 h-4 text-red-500" />
              <div class="flex space-x-2">
                <div>Setup failed.</div>
              </div>
            </div>
          </Show>
        </div>
      </div>
      <div class="absolute z-0 top-0 bottom-0 w-full p-4">
        <div id="terminal" class="w-full h-full"></div>
        <div class="absolute top-0 w-full h-[68px] bg-gradient-to-b from-black to-transparent"></div>
        <div class="absolute bottom-0 w-full h-[68px] bg-gradient-to-t from-black to-transparent"></div>
      </div>
    </div>
  );
};
