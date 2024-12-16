/**
 * @file 首页
 */
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ViewComponent, ViewComponentProps } from "@/store/types";
import { base, Handler } from "@/domains/base";
import { RequestCore } from "@/domains/request";
import { execute } from "@/biz/requests";
import { downloadLobeChatBundle, resizePTYWindowSize, showLobeChatWindow, startPTY } from "@/biz/services";
import { debounce } from "@/utils/lodash/debounce";
import { sleep } from "@/utils";

function HomeIndexPageCore(props: ViewComponentProps) {
  const { app } = props;

  const requests = {
    startPTY: new RequestCore(startPTY),
    resizePTY: new RequestCore(resizePTYWindowSize),
    // execute: new RequestCore(execute),
    downloadLobeChat: new RequestCore(downloadLobeChatBundle),
    showLobeChat: new RequestCore(showLobeChatWindow),
  };
  const _pty_state = {
    initial: false,
    range_start: 0,
    range_end: 0,
    step: 0,
    lines: [],
  };
  const _config: Partial<{
    app_dir: string;
    lobe_chat_repo_dir: string;
    lobe_chat_build_dir: string;
    lobe_chat_repo_url: string;
    lobe_chat_repo_dir_name: string;
    lobe_chat_server_port: string;
    github_proxy_url: string;
    npm_register_mirror_url: string;
  }> = {};
  const messages: string[] = [];
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
    scrollback: 80,
    scrollOnUserInput: true,
    scrollSensitivity: 1,
    cols: 120,
    rows: 30,
  });
  // @ts-ignore
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  // @ts-ignore
  term.loadAddon(new CanvasAddon.CanvasAddon());
  // @ts-ignore
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  // term.onData((data: string) => {
  //   execute(data);
  // });

  // console.log("config", config);
  function fetchEnvOfLanguageOrSDK(lines: string[]) {
    // console.log("fetchEnvOfLanguageOrSDK", lines);
    const env: { deno?: { version: string } } = {};
    const latest_line = lines[lines.length - 2];
    const regex = /deno ([0-9.]{1,})/;
    const m1 = latest_line && latest_line.match(regex);
    if (m1) {
      env["deno"] = {
        version: m1[1],
      };
    }
    return env;
  }

  async function checkENV() {
    await execute(`deno -v\r`);
  }
  async function startLobeChatServer() {
    console.log("[PAGE]home/index - startLobeChatServer", _config.lobe_chat_build_dir);
    await execute(`cd ${_config.lobe_chat_build_dir}\r`);
    await execute(`deno run --allow-all server.cjs\r`);

    // await requests.execute.run("set_complete", { task: "frontend" });
  }
  function getTermLines(messages: string[], range: number[]) {
    const lines: string[] = [];
    for (let i = range[0]; i < range[1] + 1; i += 1) {
      //   const text = term.buffer.active.getLine(i)?.translateToString();
      const text = messages[i];
      if (text) {
        lines.push(text);
      }
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
    if (_pty_state.step === 0) {
      // const buf = term.buffer.active;
      // const end = buf.cursorY;
      _pty_state.range_end = messages.length - 1;
      const lines = getTermLines(messages, [_pty_state.range_start, _pty_state.range_end]);
      _pty_state.range_start = _pty_state.range_end;
      console.log("lines", lines);
      // _pty_state.cur_line = end;
      const env = fetchEnvOfLanguageOrSDK(lines);
      console.log(env);
      // _state.env = env;
      if (env["deno"] === undefined) {
        return;
      }
      _pty_state.initial = true;
      // if (config.lobe_chat_repo_dir === undefined) {
      //   _state.step = 1;
      //   cloneLobeChatRepo(config, _state);
      //   return;
      // }
      if (_config.lobe_chat_build_dir === undefined) {
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
      startLobeChatServer();
      return;
    }
    if (_pty_state.step === 2) {
      // const buf = term.buffer.active;
      // const end1 = buf.cursorY;
      // const end2 = buf.length - 1;
      _pty_state.range_end = messages.length - 1;
      const lines = getTermLines(messages, [_pty_state.range_start, _pty_state.range_end]);
      _pty_state.range_start = _pty_state.range_end;
      console.log("lines", lines);
      // const lines = getTermLines([_pty_state.range_start, end2]);
      const str_lines = lines.map((l) => l.trim()).filter(Boolean);
      const line1 = str_lines[str_lines.length - 1];
      // const line2 = str_lines[str_lines.length - 2];
      console.log(
        "2. check the dependencies of lobe-chat is installed.",
        line1,
        str_lines,
        term.buffer.active.cursorY,
        term.buffer.active.length
      );
      if (line1 && line1.match(/Done in [0-9.]{1,}m{0,1}s/)) {
        _pty_state.step = 4;
        //   // console.log("install dependencies is ok, then build");
        //   buildLobeChat(config, state);
        return;
      }
      // if (line2 && line2.match(/Done in [0-9.]{1,}m{0,1}s/)) {
      //   _state.step = 3;
      //   // console.log("install dependencies is ok, then build");
      //   buildLobeChat(config, state);
      //   return;
      // }
      return;
    }
    // if (_state.step == 3) {
    //   const buf = term.buffer.active;
    //   const end2 = buf.length - 1;
    //   const lines = getTermLines([_state.cur_line, end2]);
    //   _state.cur_line = end2;
    //   const str_lines = lines.map((l) => l.trim()).filter(Boolean);
    //   const line = str_lines[str_lines.length - 1];
    //   console.log(
    //     "3. check the lobe-chat is builded.",
    //     line,
    //     str_lines,
    //     term.buffer.active.cursorY,
    //     term.buffer.active.length
    //   );
    //   if (line === undefined) {
    //     return;
    //   }
    //   if (line.match(/^🟢/)) {
    //     _state.step = 4;
    //     startLobeChatServer();
    //     return;
    //   }
    //   return;
    // }
    if (_pty_state.step === 4) {
      _pty_state.range_end = messages.length - 1;
      const lines = getTermLines(messages, [_pty_state.range_start, _pty_state.range_end]);
      _pty_state.range_start = _pty_state.range_end;
      // console.log("lines", lines, messages, _pty_state.range_end);
      // const buf = term.buffer.active;
      // const end2 = buf.length - 1;
      // const lines = getTermLines([_pty_state.range_start, end2]);
      // _pty_state.range_start = end2;
      const str_lines = lines.map((l) => l.trim()).filter(Boolean);
      // console.log("4. check the lobe-chat server is running.", str_lines);
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
      if (url === null) {
        url = `http://localhost:${_config.lobe_chat_server_port}`;
      }
      let ready = str_lines.find((line) => {
        return line.match(/Ready in [0-9]{1,}ms/);
      });
      if (ready === undefined) {
        return;
      }
      await requests.showLobeChat.run();
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
  function numbersToChars(arr: number[]) {
    return arr.map((num) => String.fromCharCode(num));
  }
  listen<number[]>("data", (event) => {
    // const { change_type: type, paths } = event.payload;
    // if (type === "") {
    //   return;
    // }
    // bus.emit(Events.Change, { ...state });
    const message = event.payload;
    const msg = numbersToChars(message).join("");
    const lines = msg.split("↵");
    console.log(msg);
    messages.push(...lines);
    term.write(message);
    term.scrollToBottom();
    handle_output();
  });
  listen("tauri://close-requested", (event) => {
    execute("\x03");
    term.dispose();
  });

  return {
    state,
    ui: {},
    async ready() {
      console.log("[PAGE]home/index");
      // @ts-ignore
      const { load } = window.__TAURI__.store;
      const store = await load("store.json", { autoSave: false });
      const lobe_chat_repo_dir = await store.get("lobe_chat_repo_dir");
      const lobe_chat_build_dir = await store.get("lobe_chat_build_dir");
      const app_dir = await store.get("app_dir");
      const lobe_chat_server_port = await store.get("lobe_chat_server_port");
      const github_proxy_url = await store.get("github_proxy_url");
      // const lobe_chat_repo_url = await store.get("lobe_chat_repo_url");
      // const npm_register_mirror_url = await store.get("npm_register_mirror_url");
      Object.assign(_config, {
        app_dir,
        lobe_chat_repo_dir,
        lobe_chat_build_dir,
        // lobe_chat_repo_url,
        lobe_chat_server_port,
        github_proxy_url,
        // npm_register_mirror_url,
      });
      term.open(document.getElementById("terminal"));
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
      checkENV();
      // config.lobe_chat_repo_dir_name = lobe_chat_repo_url.split("/").pop();
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
      <div data-tauri-drag-region class="absolute z-10 top-0 h-[48px] w-full ">
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
          {/* <img class="w-full h-full text-gray-500 hover:text-gray-800" src="/mdi_close.svg" alt="close" /> */}
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
