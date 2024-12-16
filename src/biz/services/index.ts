import { request } from "@/biz/requests";

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
  return request.post("async_shell", {});
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
export function showLobeChatWindow() {
  return request.post<void>("set_complete", {});
}