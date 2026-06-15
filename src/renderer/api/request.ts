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
  type RequestClientOptions,
  type RequestError,
} from '../../shared/request-client';

import { getAccessToken, handleLoginExpired } from './access';

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
  const client = new RequestClient({ ...options, baseURL });

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

  // 后端 R 包装：{ code, message, data }，code === 0 视为成功。
  client.addResponseInterceptor(
    defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 0,
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
export const baseRequestClient = new RequestClient({ baseURL: apiURL });

export { getAccessToken, setAccessToken } from './access';
