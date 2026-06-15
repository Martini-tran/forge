// Preload: expose a minimal, typed `window.launcher` API to the renderer over
// IPC. Runs in an isolated context with contextIsolation enabled.
import { contextBridge, ipcRenderer } from "electron";
import type { AppEntry, CustomApp } from "../shared/AppEntry";
import type { SettingsSnapshot } from "../shared/Settings";
import type { PluginInfo } from "../shared/PluginInfo";
import type { PluginConfigValues } from "../shared/PluginConfig";
import type { SearchResult } from "../shared/SearchResult";

type NewCustomApp = Omit<CustomApp, "id" | "createdAt">;

const launcher = {
  /* ----------------------------------------------------------------- apps */

  /** Fetch the merged entry list (scanned + custom); triggers a rescan. */
  listApps: (): Promise<AppEntry[]> => ipcRenderer.invoke("apps:list"),

  /** Fetch the most recently launched apps (default view). */
  listRecents: (): Promise<AppEntry[]> => ipcRenderer.invoke("apps:recents"),

  /** Launch an entry by id. */
  launchApp: (id: string): Promise<void> =>
    ipcRenderer.invoke("apps:launch", id),

  /** Hide the launcher window. */
  hide: (): Promise<void> => ipcRenderer.invoke("window:hide"),

  /** Open an http(s)/mailto link in the default browser / mail client. */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:openExternal", url),

  /** Ask main to resize the window to the given content height (px). */
  resize: (height: number): void => ipcRenderer.send("window:resize", height),

  /** Subscribe to background-refreshed app lists. Returns an unsubscribe fn. */
  onAppsUpdated: (cb: (apps: AppEntry[]) => void): (() => void) => {
    const listener = (_e: unknown, apps: AppEntry[]) => cb(apps);
    ipcRenderer.on("apps:updated", listener);
    return () => ipcRenderer.removeListener("apps:updated", listener);
  },

  /** Fired each time the window is shown; use to reset the query. */
  onShown: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("window:shown", listener);
    return () => ipcRenderer.removeListener("window:shown", listener);
  },

  /* ------------------------------------------------------------- settings */

  /** Open (or focus) the settings window. */
  openSettings: (): Promise<void> => ipcRenderer.invoke("settings:open"),

  /** Current settings snapshot (theme, hotkey, …). */
  getSettings: (): Promise<SettingsSnapshot> =>
    ipcRenderer.invoke("settings:get"),

  /** Persist a single setting (broadcasts settings:changed). */
  setSetting: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke("settings:set", key, value),

  /** Rebind the toggle hotkey; resolves false if the accelerator is invalid. */
  setHotkey: (accel: string): Promise<boolean> =>
    ipcRenderer.invoke("settings:hotkey:set", accel),

  /** Enable/disable launching the app at OS login. */
  setOpenAtLogin: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("settings:openAtLogin:set", enabled),

  /** Subscribe to settings changes (e.g. to re-apply theme). */
  onSettingsChanged: (cb: (s: SettingsSnapshot) => void): (() => void) => {
    const listener = (_e: unknown, s: SettingsSnapshot) => cb(s);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },

  /* ----------------------------------------------------------- quick open */

  /** Open a native file picker; resolves the chosen path, or '' if cancelled. */
  pickPath: (): Promise<string> => ipcRenderer.invoke("dialog:pickPath"),

  listCustom: (): Promise<CustomApp[]> =>
    ipcRenderer.invoke("quickopen:listCustom"),
  addCustom: (entry: NewCustomApp): Promise<CustomApp> =>
    ipcRenderer.invoke("quickopen:addCustom", entry),
  updateCustom: (entry: CustomApp): Promise<void> =>
    ipcRenderer.invoke("quickopen:updateCustom", entry),
  deleteCustom: (id: string): Promise<void> =>
    ipcRenderer.invoke("quickopen:deleteCustom", id),
  /** Scanned apps (incl. hidden, with a flag), for the management list. */
  listScanned: (): Promise<AppEntry[]> =>
    ipcRenderer.invoke("quickopen:listScanned"),
  setAlias: (appId: string, keywords: string): Promise<void> =>
    ipcRenderer.invoke("quickopen:setAlias", appId, keywords),
  /** Hide/unhide a scanned app from search. */
  hideScanned: (appId: string, hidden: boolean): Promise<void> =>
    ipcRenderer.invoke("quickopen:hideScanned", appId, hidden),
  /** Prune uninstalled custom entries + rescan; resolves removed-count. */
  syncQuickOpen: (): Promise<{ removedCustom: number }> =>
    ipcRenderer.invoke("quickopen:sync"),

  /* -------------------------------------------------------------- plugins */

  listPlugins: (): Promise<PluginInfo[]> => ipcRenderer.invoke("plugins:list"),
  /** Record that a view plugin was opened (for the "recently used" ranking). */
  usePlugin: (id: string): Promise<void> =>
    ipcRenderer.invoke("plugins:use", id),
  /** Pop a view plugin out into its own detached window. */
  detachPlugin: (id: string): Promise<void> =>
    ipcRenderer.invoke("plugins:detach", id),
  /** Detached plugin window: current pin (always-on-top) state. */
  getPluginWindowState: (): Promise<{ alwaysOnTop: boolean }> =>
    ipcRenderer.invoke("pluginWindow:getState"),
  /** Detached plugin window: pin/unpin above all applications. */
  setPluginWindowAlwaysOnTop: (on: boolean): Promise<void> =>
    ipcRenderer.invoke("pluginWindow:setAlwaysOnTop", on),
  /** Set a plugin's user-defined search keywords (empty string clears them). */
  setPluginKeywords: (id: string, keywords: string): Promise<void> =>
    ipcRenderer.invoke("plugins:setKeywords", id, keywords),
  setPluginEnabled: (id: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("plugins:setEnabled", id, enabled),
  /** Pick a `.orcpkg` and install it; resolves the new plugin, or null if cancelled. */
  installPlugin: (): Promise<PluginInfo | null> =>
    ipcRenderer.invoke("plugins:install"),
  /** Uninstall a plugin (remove from disk + clear its stored state). */
  uninstallPlugin: (id: string): Promise<void> =>
    ipcRenderer.invoke("plugins:uninstall", id),
  /** Toggle whether a view plugin opens in its detached window by default. */
  setPluginOpenInWindow: (id: string, on: boolean): Promise<void> =>
    ipcRenderer.invoke("plugins:setOpenInWindow", id, on),
  /** Persist a plugin's config; resolves the new effective (coerced) values. */
  setPluginConfig: (
    id: string,
    values: PluginConfigValues,
  ): Promise<PluginConfigValues> =>
    ipcRenderer.invoke("plugins:setConfig", id, values),

  /** Run enabled plugins' search hooks; returns their combined results. */
  searchPlugins: (query: string): Promise<SearchResult[]> =>
    ipcRenderer.invoke("plugins:search", query),
  /** Activate a plugin result by its plugin id + action. */
  executePlugin: (pluginId: string, action: string): Promise<void> =>
    ipcRenderer.invoke("plugins:execute", pluginId, action),

  /** Switch the launcher window between content-sized root and fixed plugin view. */
  setMode: (mode: "root" | "plugin"): void =>
    ipcRenderer.send("window:setMode", mode),

  /** Fired when a plugin UI asks to return to root (back/close/Esc). */
  onPluginExit: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on("plugin:exit", listener);
    return () => ipcRenderer.removeListener("plugin:exit", listener);
  },
};

export type LauncherApi = typeof launcher;

contextBridge.exposeInMainWorld("launcher", launcher);
