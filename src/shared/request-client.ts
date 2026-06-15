/**
 * 自包含的 HTTP 请求客户端，基于 fetch 实现（零第三方依赖）。环境无关：
 * 渲染进程用内置 fetch；主进程（含插件 HTTP 能力）可注入 electron 的 net.fetch
 * （走 Chromium 网络栈、识别系统代理）。
 *
 * API 形态参考 @nebula/request：一个 RequestClient 类 + 请求/响应拦截器链 +
 * 三个开箱即用的拦截器工厂（defaultResponseInterceptor /
 * authenticateResponseInterceptor / errorMessageResponseInterceptor）。
 * 拦截器链的语义与 axios 一致：按注册顺序串成 Promise 链，成功走 fulfilled、
 * 失败走 rejected，rejected 里可以恢复（返回值）或继续抛出。
 */

/** 可注入的 fetch 实现（默认用全局 fetch，主进程可传 net.fetch）。 */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** 单次请求的配置；额外字段会原样透传，方便拦截器读取自定义标记。 */
export interface RequestConfig<D = any> {
  baseURL?: string;
  /** 相对或绝对 URL；最终与 baseURL 拼接。 */
  url?: string;
  method?: string;
  /** 请求头；拦截器通常在这里写入 Authorization 等。 */
  headers?: Record<string, any>;
  /** 拼到 URL 上的查询参数。 */
  params?: Record<string, any>;
  /** 请求体；对象会被 JSON.stringify，其余类型原样传给 fetch。 */
  data?: D;
  /** 超时毫秒数（基于 AbortController）。 */
  timeout?: number;
  /** 外部取消信号。 */
  signal?: AbortSignal;
  /**
   * 返回值形态：
   * - 'raw'  整个 RequestResponse（含 status/headers）
   * - 'body' 响应体（后端的 R 包装，如 { code, data, message }）
   * - 'data' 解包后的业务数据（R.data），默认用于 requestClient
   */
  responseReturn?: 'data' | 'body' | 'raw';
  /** 内部重试标记，避免 401 刷新后无限重试。 */
  _retry?: boolean;
  [key: string]: any;
}

/** fetch 成功后包装出的响应对象，结构对齐 axios 的 response。 */
export interface RequestResponse<T = any> {
  config: RequestConfig;
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

/** 请求失败时抛出的错误，携带原始 config/response，便于拦截器分支处理。 */
export interface RequestError<T = any> extends Error {
  config?: RequestConfig;
  response?: RequestResponse<T>;
  status?: number;
  /** 被取消（超时或外部 abort）时为 true。 */
  isCancel?: boolean;
}

/** 一个拦截器：fulfilled 处理正常值，rejected 处理异常。 */
export interface Interceptor<V> {
  fulfilled?: (value: V) => V | Promise<V>;
  rejected?: (error: any) => any;
}

/** 创建 RequestClient 的选项：请求默认值 + 可注入的 fetch 实现。 */
export type RequestClientOptions = RequestConfig & { fetch?: FetchLike };

function isPlainObject(v: unknown): v is Record<string, any> {
  return Object.prototype.toString.call(v) === '[object Object]';
}

/** 构造带查询参数的完整 URL（绝对地址直接用，否则与 baseURL 拼接）。 */
export function resolveRequestURL(
  baseURL: string,
  url: string,
  params?: Record<string, any>,
): string {
  const isAbsolute = /^https?:\/\//i.test(url);
  let full = isAbsolute
    ? url
    : `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  if (params && Object.keys(params).length > 0) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      usp.append(k, String(v));
    }
    const qs = usp.toString();
    if (qs) full += (full.includes('?') ? '&' : '?') + qs;
  }
  return full;
}

function makeError(
  message: string,
  config: RequestConfig,
  response?: RequestResponse,
  extra?: Partial<RequestError>,
): RequestError {
  const err = new Error(message) as RequestError;
  err.config = config;
  err.response = response;
  err.status = response?.status;
  return Object.assign(err, extra);
}

export class RequestClient {
  private readonly defaults: RequestConfig;
  private readonly fetchImpl: FetchLike;
  private readonly requestInterceptors: Interceptor<RequestConfig>[] = [];
  private readonly responseInterceptors: Interceptor<RequestResponse>[] = [];

  constructor(options: RequestClientOptions = {}) {
    const { fetch: fetchImpl, ...rest } = options;
    this.fetchImpl =
      fetchImpl ?? ((globalThis as any).fetch?.bind(globalThis) as FetchLike);
    this.defaults = {
      baseURL: '',
      method: 'GET',
      headers: {},
      responseReturn: 'raw',
      timeout: 0,
      ...rest,
    };
  }

  /** 注册请求拦截器（按注册顺序执行）。 */
  addRequestInterceptor(interceptor: Interceptor<RequestConfig>): void {
    this.requestInterceptors.push(interceptor);
  }

  /** 注册响应拦截器（按注册顺序串成链）。 */
  addResponseInterceptor<T = any>(
    interceptor: Interceptor<RequestResponse<T>>,
  ): void {
    this.responseInterceptors.push(
      interceptor as Interceptor<RequestResponse>,
    );
  }

  /** 发起请求。返回值形态由 config.responseReturn 决定。 */
  async request<T = any>(config: RequestConfig): Promise<T> {
    let merged: RequestConfig = {
      ...this.defaults,
      ...config,
      headers: { ...this.defaults.headers, ...config.headers },
    };

    // 1) 请求拦截器链
    let cfgChain: Promise<RequestConfig> = Promise.resolve(merged);
    for (const i of this.requestInterceptors) {
      cfgChain = cfgChain.then(i.fulfilled, i.rejected);
    }
    merged = await cfgChain;

    // 2) 实际发送
    let respChain: Promise<any> = this.dispatch(merged);

    // 3) 响应拦截器链（成功走 fulfilled、失败走 rejected）
    for (const i of this.responseInterceptors) {
      respChain = respChain.then(i.fulfilled, i.rejected);
    }

    return respChain as Promise<T>;
  }

  get<T = any>(url: string, config: RequestConfig = {}): Promise<T> {
    return this.request<T>({ ...config, url, method: 'GET' });
  }

  delete<T = any>(url: string, config: RequestConfig = {}): Promise<T> {
    return this.request<T>({ ...config, url, method: 'DELETE' });
  }

  post<T = any>(
    url: string,
    data?: any,
    config: RequestConfig = {},
  ): Promise<T> {
    return this.request<T>({ ...config, url, data, method: 'POST' });
  }

  put<T = any>(
    url: string,
    data?: any,
    config: RequestConfig = {},
  ): Promise<T> {
    return this.request<T>({ ...config, url, data, method: 'PUT' });
  }

  patch<T = any>(
    url: string,
    data?: any,
    config: RequestConfig = {},
  ): Promise<T> {
    return this.request<T>({ ...config, url, data, method: 'PATCH' });
  }

  /** 真正调用 fetch，组装出 RequestResponse；非 2x/3xx 抛出 RequestError。 */
  private async dispatch(config: RequestConfig): Promise<RequestResponse> {
    const url = resolveRequestURL(
      config.baseURL ?? '',
      config.url ?? '',
      config.params,
    );

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.headers ?? {})) {
      if (v === undefined || v === null) continue;
      headers[k] = String(v);
    }

    // 请求体：纯对象 → JSON（并补默认 Content-Type），其余原样传递。
    let body: BodyInit | undefined;
    if (config.data !== undefined && config.data !== null) {
      if (isPlainObject(config.data) || Array.isArray(config.data)) {
        body = JSON.stringify(config.data);
        if (!('Content-Type' in headers) && !('content-type' in headers)) {
          headers['Content-Type'] = 'application/json';
        }
      } else {
        body = config.data as BodyInit;
      }
    }

    // 超时：用 AbortController，并与外部 signal 合流。
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (config.timeout && config.timeout > 0) {
      timer = setTimeout(() => controller.abort(), config.timeout);
    }
    if (config.signal) {
      if (config.signal.aborted) controller.abort();
      else
        config.signal.addEventListener('abort', () => controller.abort(), {
          once: true,
        });
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: (config.method ?? 'GET').toUpperCase(),
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      const aborted = err?.name === 'AbortError';
      throw makeError(
        aborted ? 'Request canceled' : (err?.message ?? 'Network Error'),
        config,
        undefined,
        { isCancel: aborted },
      );
    }
    if (timer) clearTimeout(timer);

    // 按 content-type 解析响应体。
    const ct = res.headers.get('content-type') ?? '';
    let data: any = null;
    try {
      data = ct.includes('application/json') ? await res.json() : await res.text();
    } catch {
      data = null; // 空响应体或解析失败
    }

    const response: RequestResponse = {
      config,
      data,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    };

    if (!res.ok) {
      throw makeError(
        `Request failed with status code ${res.status}`,
        config,
        response,
      );
    }
    return response;
  }
}

/**
 * 默认响应拦截器：按 responseReturn 解包，并校验后端 R 包装的业务码。
 * - responseReturn === 'raw'  → 返回整个 RequestResponse
 * - responseReturn === 'body' → 返回响应体
 * - responseReturn === 'data' → 校验 code，成功返回 data 字段，否则抛业务错误
 */
export function defaultResponseInterceptor(options: {
  codeField?: string;
  dataField?: string;
  successCode?: number | string | ((code: any) => boolean);
}): Interceptor<RequestResponse> {
  const { codeField = 'code', dataField = 'data', successCode = 0 } = options;
  return {
    fulfilled: (response) => {
      const { config, data } = response;
      if (config.responseReturn === 'raw') return response;
      if (config.responseReturn === 'body') return data as any;

      // responseReturn === 'data'：解包业务数据。
      const code = data?.[codeField];
      const ok =
        typeof successCode === 'function'
          ? successCode(code)
          : code === successCode;
      if (ok) return data?.[dataField] as any;

      throw makeError(
        data?.message ?? data?.msg ?? 'Business Error',
        config,
        response,
      );
    },
  };
}

/**
 * 鉴权响应拦截器：处理 401。可选地用 doRefreshToken 刷新令牌并重放原请求，
 * 否则（或重试仍失败）调用 doReAuthenticate 走重新登录流程。
 */
export function authenticateResponseInterceptor(options: {
  client: RequestClient;
  doReAuthenticate: () => Promise<void>;
  doRefreshToken: () => Promise<string>;
  enableRefreshToken?: boolean;
  formatToken: (token: null | string) => null | string;
}): Interceptor<RequestResponse> {
  const {
    client,
    doReAuthenticate,
    doRefreshToken,
    enableRefreshToken = false,
    formatToken,
  } = options;
  return {
    rejected: async (error: RequestError) => {
      const config = error.config;
      const status = error.response?.status;
      if (status !== 401 || !config) throw error;

      // 未开启刷新，或本次已是重试 → 直接重新认证。
      if (!enableRefreshToken || config._retry) {
        await doReAuthenticate();
        throw error;
      }

      try {
        const newToken = await doRefreshToken();
        config._retry = true;
        config.headers = {
          ...config.headers,
          Authorization: formatToken(newToken),
        };
        return await client.request(config);
      } catch {
        await doReAuthenticate();
        throw error;
      }
    },
  };
}

/** 默认的状态码 → 文案映射，未匹配到业务错误信息时兜底。 */
function defaultMessageByStatus(status?: number): string {
  switch (status) {
    case 400:
      return '请求参数错误';
    case 401:
      return '登录已过期，请重新登录';
    case 403:
      return '没有权限访问该资源';
    case 404:
      return '请求的资源不存在';
    case 500:
      return '服务器内部错误';
    case 502:
      return '网关错误';
    case 503:
      return '服务暂不可用';
    default:
      return status ? `请求失败（${status}）` : '网络异常，请检查网络连接';
  }
}

/**
 * 通用错误提示拦截器：兜底处理上面拦截器未消化的错误。把人类可读的消息
 * （业务信息优先，否则按状态码兜底）连同原始 error 交给 makeMessage 回调，
 * 由调用方决定如何展示（toast / 控制台 / 自定义 UI）。
 */
export function errorMessageResponseInterceptor(
  makeMessage: (msg: string, error: RequestError) => void,
): Interceptor<RequestResponse> {
  return {
    rejected: (error: RequestError) => {
      if (error?.isCancel) throw error; // 主动取消不提示
      const responseData = error?.response?.data ?? {};
      const businessMsg =
        responseData?.error ?? responseData?.message ?? responseData?.msg ?? '';
      const msg = businessMsg || defaultMessageByStatus(error?.response?.status);
      try {
        makeMessage(msg, error);
      } catch {
        /* 提示回调自身的异常不应影响错误传播 */
      }
      throw error;
    },
  };
}
