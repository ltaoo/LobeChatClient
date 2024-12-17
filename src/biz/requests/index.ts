import { invoke } from "@tauri-apps/api/core";

import { request_factory } from "@/domains/request/utils";
import { Result } from "@/domains/result";

import { BaseApiResp } from "./types";

export const request = request_factory({
  hostnames: {
    dev: "",
    test: "",
    prod: "",
  },
  process<T>(r: Result<BaseApiResp<T>>) {
    if (r.error) {
      return Result.Err(r.error.message);
    }
    const { code, msg, data } = r.data;
    if (code !== 0) {
      return Result.Err(msg, code, data);
    }
    return Result.Ok(data as T);
  },
});

export function execute(command: string) {
  return invoke("write_to_pty", { data: command });
}
