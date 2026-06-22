import { net } from "electron";

/**
 * Backend HTTP bridge.
 *
 * The renderer's request client (src/renderer/api/request.ts) cannot fetch the
 * nebula backend directly: the renderer is a Chromium context (dev: an
 * http://localhost origin, prod: file://), so a cross-origin call to the gateway
 * is blocked by CORS — and the gateway sends no CORS headers. Routing the fetch
 * through the main process sidesteps CORS entirely: `net.fetch` here runs on
 * Chromium's net stack but is NOT subject to renderer same-origin policy, and it
 * is system-proxy aware. The renderer injects this as its fetch implementation
 * over IPC, so the existing RequestClient/interceptor chain is reused unchanged.
 */

/**
 * Backend base URL. The renderer normally composes an absolute URL from
 * VITE_API_BASE_URL; when that env isn't set (e.g. dev server started before
 * `.env` existed) the renderer sends a relative path like `/forge/front/...`,
 * which we resolve here against this base — the nebula gateway. Override at
 * runtime with the `NEBULA_API_BASE_URL` (or `VITE_API_BASE_URL`) env var.
 */
const DEFAULT_BACKEND_BASE_URL = "http://localhost:19000";

function backendBaseUrl(): string {
  const fromEnv =
    process.env.NEBULA_API_BASE_URL || process.env.VITE_API_BASE_URL;
  const base = fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_BACKEND_BASE_URL;
  return base.replace(/\/+$/, "");
}

/** Resolve a (possibly relative) request URL to an absolute http(s) URL. */
function resolveBackendUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url; // already absolute — http or https both fine
  }
  return `${backendBaseUrl()}/${url.replace(/^\/+/, "")}`;
}

/** Serializable request from the renderer (a Request/Response can't cross IPC). */
export interface BackendFetchRequest {
  /** Absolute http(s) URL, or a path relative to the backend base URL. */
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Pre-serialized body (the request client JSON.stringifies objects). */
  body?: string;
}

/** Serializable response handed back to the renderer to rebuild a Response. */
export interface BackendFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export async function backendFetch(
  req: BackendFetchRequest,
): Promise<BackendFetchResponse> {
  if (!req || typeof req.url !== "string" || !req.url) {
    throw new Error("后端请求地址为空");
  }
  const url = resolveBackendUrl(req.url);
  const res = await net.fetch(url, {
    method: (req.method ?? "GET").toUpperCase(),
    headers: req.headers,
    body: req.body,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = await res.text();
  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    body,
  };
}
