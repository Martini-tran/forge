// Plugin-UI preload: exposes a tiny, audited `window.pluginHost` bridge to the
// third-party plugin UI running in a sandboxed <webview> (contextIsolation on,
// nodeIntegration off). It deliberately does NOT expose require, ipcRenderer,
// or the launcher's window.launcher API, and it never sends its own plugin id —
// the main process derives that from the webview's committed plugin:// origin.
import { contextBridge, ipcRenderer } from 'electron';

type PluginTheme = 'light' | 'dark';

/** Config for a request issued from a plugin UI (mirrors RequestConfig). */
interface PluginRequestConfig {
  url: string;
  method?: string;
  /** Overrides the manifest's request.baseURL for this call. */
  baseURL?: string;
  headers?: Record<string, string>;
  /** Query params appended to the URL. */
  params?: Record<string, unknown>;
  /** Request body; plain objects are sent as JSON. */
  data?: unknown;
  /** Per-request timeout in ms. */
  timeout?: number;
  /** Return shape: 'body' (default), 'raw' (status/headers) or 'data'. */
  responseReturn?: 'data' | 'body' | 'raw';
}

/** A thin per-baseURL client wrapping pluginHost.request. */
interface PluginHttpClient {
  request(config: PluginRequestConfig): Promise<unknown>;
  get(url: string, config?: Partial<PluginRequestConfig>): Promise<unknown>;
  delete(url: string, config?: Partial<PluginRequestConfig>): Promise<unknown>;
  post(
    url: string,
    data?: unknown,
    config?: Partial<PluginRequestConfig>,
  ): Promise<unknown>;
  put(
    url: string,
    data?: unknown,
    config?: Partial<PluginRequestConfig>,
  ): Promise<unknown>;
  patch(
    url: string,
    data?: unknown,
    config?: Partial<PluginRequestConfig>,
  ): Promise<unknown>;
}

const pluginHost = {
  /** Call one of this plugin's allow-listed main-side RPC methods. */
  invoke: (method: string, args?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('plugin:invoke', method, args),
  /**
   * Issue an HTTP request. The actual fetch runs in the main process (Chromium
   * net stack), so it isn't bound by the plugin:// CSP. `baseURL` defaults to
   * the plugin's manifest `request.baseURL` but can be overridden per call.
   * Returns the parsed body by default.
   */
  request: (config: PluginRequestConfig): Promise<unknown> =>
    ipcRenderer.invoke('plugin:request', config),
  /** Create a small client bound to a baseURL (and other defaults). */
  createClient: (
    defaults: Partial<PluginRequestConfig> = {},
  ): PluginHttpClient => {
    const send = (config: PluginRequestConfig) =>
      ipcRenderer.invoke('plugin:request', { ...defaults, ...config });
    return {
      request: (config) => send(config),
      get: (url, config) => send({ ...config, url, method: 'GET' }),
      delete: (url, config) => send({ ...config, url, method: 'DELETE' }),
      post: (url, data, config) =>
        send({ ...config, url, data, method: 'POST' }),
      put: (url, data, config) => send({ ...config, url, data, method: 'PUT' }),
      patch: (url, data, config) =>
        send({ ...config, url, data, method: 'PATCH' }),
    };
  },
  /** Finish: hide the launcher (e.g. after picking a result). */
  close: (): void => ipcRenderer.send('plugin:close'),
  /** Return to the launcher's root view. */
  back: (): void => ipcRenderer.send('plugin:back'),
  /** The current resolved app theme, so the UI can match light/dark on load. */
  getTheme: (): Promise<PluginTheme> => ipcRenderer.invoke('plugin:getTheme'),
  /** Subscribe to theme changes; returns an unsubscribe fn. */
  onThemeChanged: (cb: (theme: PluginTheme) => void): (() => void) => {
    const listener = (_e: unknown, theme: PluginTheme) => cb(theme);
    ipcRenderer.on('plugin:theme', listener);
    return () => ipcRenderer.removeListener('plugin:theme', listener);
  },
  /** This plugin's effective config (manifest defaults + user overrides). */
  getConfig: (): Promise<Record<string, string | number | boolean>> =>
    ipcRenderer.invoke('plugin:getConfig'),
  /** Subscribe to config changes; returns an unsubscribe fn. */
  onConfigChanged: (
    cb: (config: Record<string, string | number | boolean>) => void,
  ): (() => void) => {
    const listener = (
      _e: unknown,
      config: Record<string, string | number | boolean>,
    ) => cb(config);
    ipcRenderer.on('plugin:config', listener);
    return () => ipcRenderer.removeListener('plugin:config', listener);
  },
};

contextBridge.exposeInMainWorld('pluginHost', pluginHost);

export type PluginHostApi = typeof pluginHost;
