const { invoke } = window.__TAURI__.core;

let $container;
let lobeChatServerFailed = false;

async function greet() {
  // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  greetMsgEl.textContent = await invoke("greet", { name: greetInputEl.value });
}
function sleep(delay = 3000) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, delay);
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  $container = document.querySelector("#container");
  // const r = await invoke("check_has_nodejs", {});
  // $container.innerText = `${$container.innerText}\nStart LobeChat Server...`;
  var term = new Terminal({
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
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    allowProposedApi: false,
    tabStopWidth: 4,
    smoothScrollDuration: 0,
    scrollback: 80,
    scrollOnUserInput: true,
    scrollSensitivity: 1,
    cols: 80,
    rows: 24,
  });
  term.open(document.getElementById("terminal"));
  // term.write("Hello from \x1B[1;3;31mxterm.js\x1B[0m $ ");

  window.__TAURI__.event.listen("data", (event) => {
    const message = event.payload;

    term.write(message);
    // if (!$container) {
    //   return;
    // }
    // console.log(message, message.includes("Failed to start server"));
    // if (message.includes("Failed to start server")) {
    //   lobeChatServerFailed = true;
    // }
    // $container.innerText = `${$container.innerText}\n${message}`;
  });
  window.__TAURI__.event.listen("tauri://close-requested", (event) => {
    invoke("write_to_pty", {
      data: "\x03",
    });
  });
  function writeToPty(data) {
    void invoke("write_to_pty", {
      data,
    });
  }
  term.onData(writeToPty);

  const r2 = await invoke("async_shell", {});
  // let dir2 = "/Users/litao/Documents/temp/fake_npm_start";
  let dir2 = "/Users/litao/Documents/workspace/lobe-chat";
  await invoke("write_to_pty", {
    data: `cd ${dir2}\r\n`,
  });
  // await sleep(200);
  // await invoke("write_to_pty", {
  //   data: "ls\r\n",
  // });
  await sleep(200);
  await invoke("write_to_pty", {
    data: "npm run start\r\n",
  });
  // await invoke("write_to_pty", {
  //   data: "\x03",
  // });
  // const r2 = await invoke("start_lobe_chat", {});
  // await sleep(800);
  // if (lobeChatServerFailed) {
  //   $container.innerText = `${$container.innerText}\n\n\nLaunch LobeChat failed`;
  //   return;
  // }
  // await sleep(2000);
  // window.location.href = "http://localhost:3000";
});
