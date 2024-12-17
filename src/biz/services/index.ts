import { request } from "@/biz/requests";

/** 获取初始化信息 */
export function fetchSetupConfig() {
  return request.post<{ deno_bin: string; deno_existing: boolean; lobe_chat_dir: string; lobe_chat_existing: boolean }>(
    "fetch_setup_config",
    {}
  );
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
export function downloadLobeChatBundle() {
  return request.post<void>("download_lobe_chat", {});
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
