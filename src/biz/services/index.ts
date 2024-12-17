import { request } from "@/biz/requests";

export function fetchSetupConfig() {
  return request.post<{ deno_bin: string; deno_existing: boolean; lobe_chat_dir: string }>("fetch_setup_info", {});
}

/**
 * 下载 deno 并配置环境变量
 */
export function downloadDeno() {
  return request.post<void>("download_deno_then_enable", {});
}

/**
 * 下载压缩包并解压
 */
export function downloadLobeChatBundle(payload: { url: string; path: string }) {
  return request.post<void>("download_file", payload);
}

/**
 * 启动一个 pty
 */
export function startPTY() {
  return request.post("start_pty", {});
}

/**
 */
export function resizePTYWindowSize(opt: { rows: number; cols: number }) {
  return request.post("resize_pty", opt);
}

/**
 * 向终端写入命令
 */
export function execute(params: string) {
  return request.post<void>("write_to_pty", { data: params });
}

/**
 */
export function showLobeChatWindow(body: { url: string }) {
  return request.post<void>("set_complete", body);
}
