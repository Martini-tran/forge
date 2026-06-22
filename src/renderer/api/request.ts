/**
 * 后端请求客户端的装配文件，可自行根据业务逻辑调整。
 *
 * 形态参考 nebula 的 apps/web-ele/src/api/request.ts：用 RequestClient 创建
 * 实例，并依次装上「请求头 → 解包 R → 401 处理 → 通用错误提示」四个拦截器。
 * 与 nebula 的差异：forge 是离线 Electron 应用、无 element-plus / 状态库，
 * 因此 token 走 localStorage（access.ts），错误提示走可注册的回调钩子。
 */
import {
  authenticateResponseInterceptor,
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
  RequestClient,
  type FetchLike,
  type RequestClientOptions,
  type RequestError,
} from '../../shared/request-client';

import { getAccessToken, handleLoginExpired } from './access';

/**
 * fetch 实现：经由主进程的 net.fetch 发出（IPC: backend:fetch）。
 *
 * 渲染进程是 Chromium 上下文（dev 为 http://localhost 源、prod 为 file://），
 * 直接跨源请求 nebula 网关会被 CORS 拦截，而网关不返回 CORS 头。改由主进程
 * 转发后，请求不再受同源策略约束。这里把序列化后的请求交给主进程，再用返回的
 * 状态/头/体重建一个标准 Response，喂回 RequestClient 的拦截器链（逻辑不变）。
 */
const ipcFetch: FetchLike = async (input, init) => {
  const headers: Record<string, string> = {};
  const rawHeaders = init?.headers as Record<string, unknown> | undefined;
  if (rawHeaders) {
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (v != null) headers[k] = String(v);
    }
  }
  const res = await window.launcher.backendFetch({
    url: input,
    method: init?.method,
    headers,
    body: typeof init?.body === 'string' ? init.body : undefined,
  });
  // 204/205/304 不允许带响应体，否则 Response 构造会抛错。
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
  return new Response(nullBody ? null : res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
};

// 后端基地址。优先读 Vite 环境变量 VITE_API_BASE_URL（见 .env），缺省为空串
// （表示与页面同源 / 相对路径）。用 as any 规避 vite/client 的类型依赖。
const apiURL: string =
  (import.meta as any)?.env?.VITE_API_BASE_URL ?? '';

// 是否开启刷新令牌（后端支持 refresh 时打开）。
const enableRefreshToken = false;

/** 错误提示回调：默认打到控制台，上层可替换为 toast / 自定义 UI。 */
let errorMessageHandler: (msg: string, error: RequestError) => void = (msg) => {
  console.error('[request]', msg);
};

/** 注册全局错误提示处理器（例如接入一个 toast 组件）。 */
export function setErrorMessageHandler(
  handler: (msg: string, error: RequestError) => void,
): void {
  errorMessageHandler = handler;
}

function createRequestClient(
  baseURL: string,
  options?: RequestClientOptions,
): RequestClient {
  const client = new RequestClient({ ...options, baseURL, fetch: ipcFetch });

  /** 重新认证：清空 token 并触发登录过期处理。 */
  async function doReAuthenticate() {
    console.warn('Access token is invalid or expired.');
    handleLoginExpired();
  }

  /** 刷新令牌占位：后端暂未实现 refresh，返回当前 token。 */
  async function doRefreshToken() {
    return getAccessToken() ?? '';
  }

  /** 令牌格式化：sa-token 风格，直接以原始 token 作为 Authorization 值。 */
  function formatToken(token: null | string) {
    return token ?? null;
  }

  // 请求头处理：注入 Authorization。
  client.addRequestInterceptor({
    fulfilled: async (config) => {
      const token = formatToken(getAccessToken());
      if (token) {
        config.headers = { ...config.headers, Authorization: token };
      }
      return config;
    },
  });

  // 后端 R 包装：{ code, message, data }，code === 200 视为成功
  // （nebula 的 R.success 写入 HttpStatus.SUCCESS = 200）。
  client.addResponseInterceptor(
    defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 200,
    }),
  );

  // 401 处理（可选刷新令牌后重放请求）。
  client.addResponseInterceptor(
    authenticateResponseInterceptor({
      client,
      doReAuthenticate,
      doRefreshToken,
      enableRefreshToken,
      formatToken,
    }),
  );

  // 通用错误处理：前面拦截器未消化的错误在此统一提示。
  client.addResponseInterceptor(
    errorMessageResponseInterceptor((msg, error) => {
      errorMessageHandler(msg, error);
    }),
  );

  return client;
}

/** 业务请求客户端：默认解包为后端 R 的 data 字段。 */
export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'data',
});

/** 原始请求客户端：不解包，返回整个响应（如下载、非 R 包装接口）。 */
export const baseRequestClient = new RequestClient({
  baseURL: apiURL,
  fetch: ipcFetch,
});

export { getAccessToken, setAccessToken } from './access';
