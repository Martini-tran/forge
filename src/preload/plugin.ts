// Plugin-UI preload: exposes a tiny, audited `window.pluginHost` bridge to the
// third-party plugin UI running in a sandboxed <webview> (contextIsolation on,
// nodeIntegration off). It deliberately does NOT expose require, ipcRenderer,
// or the launcher's window.launcher API, and it never sends its own plugin id —
// the main process derives that from the webview's committed plugin:// origin.
import { contextBridge, ipcRenderer } from 'electron';

type PluginTheme = 'light' | 'dark';

const pluginHost = {
  /** Call one of this plugin's allow-listed main-side RPC methods. */
  invoke: (method: string, args?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('plugin:invoke', method, args),
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
