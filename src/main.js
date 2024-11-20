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
window.__TAURI__.event.listen("command-output", (event) => {
  const { message } = event.payload;
  if (!$container) {
    return;
  }
  if (message.includes("Failed to start server")) {
    lobeChatServerFailed = true;
  }
  $container.innerText = `${$container.innerText}\n${message}`;
});
window.addEventListener("DOMContentLoaded", async () => {
  $container = document.querySelector("#container");
  const r = await invoke("check_has_nodejs", {});
  $container.innerText = `${$container.innerText}\nStart LobeChat Server...`;
  const r2 = await invoke("start_lobe_chat", {});
  if (lobeChatServerFailed) {
    $container.innerText = `${$container.innerText}\n\n\nLaunch LobeChat failed`;
    return;
  }
  await sleep();
  window.location.href = "http://localhost:3000";
});
