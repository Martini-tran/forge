import { BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { randomUUID } from "node:crypto";
import {
  getApps,
  getRecents,
  launchApp,
  emitAppsChanged,
  hideLauncherWindows,
  syncQuickOpen,
} from "../apps";
import { openSettingsWindow } from "../windows/settingsWindow";
import { fetchFavicon } from "../favicon";
import {
  getSettingsSnapshot,
  getResolvedTheme,
  updateSetting,
  broadcastSettings,
  setOpenAtLogin,
} from "../settings";
import { setToggleHotkey } from "../shortcuts/globalShortcut";
import { refreshTrayMenu } from "../tray";
import { discoverPlugins, setPluginEnabled } from "../plugins/discover";
import {
  searchPlugins,
  executePlugin,
  reloadPlugins,
  invokePlugin,
  getEffectivePluginConfig,
  getPluginRequestDefaults,
  notifyPluginConfigChanged,
} from "../plugins/runtime";
import { runPluginHttpRequest } from "../plugins/http";
import {
  pluginIdForWebContents,
  hostWindowForWebContents,
  notifyLauncher,
  notifyPluginWebviews,
  setLauncherPluginMode,
} from "../windows/mainWindow";
import {
  openPluginWindow,
  isPluginWindow,
  getPluginWindowOnTop,
  setPluginWindowAlwaysOnTop,
} from "../windows/pluginWindow";
import {
  getScannedApps,
  getCustomApps,
  addCustomApp,
  updateCustomApp,
  deleteCustomApp,
  setAlias,
  setAppHidden,
  recordUsage,
  setPluginKeywords,
  setPluginConfig,
  setPluginOpenInWindow,
} from "../../core/database";
import type { CustomApp } from "../../shared/AppEntry";
import type { PluginConfigValues } from "../../shared/PluginConfig";

/** Payload for adding a custom entry (id + createdAt are assigned in main). */
type NewCustomApp = Omit<CustomApp, "id" | "createdAt">;

/**
 * Register IPC handlers bridging the renderer (launcher + settings UI) and the
 * main process.
 */
export function registerIpcHandlers(): void {
  // Follow OS appearance changes while the theme is "system": rebroadcast so
  // every window (and plugin webview) restyles live.
  nativeTheme.on("updated", () => broadcastSettings());

  /* ---------------------------------------------------------------- apps */

  // Return the (cached) merged entry list; triggers a background refresh.
  ipcMain.handle("apps:list", () => getApps());

  // Return the most recently launched apps (default view).
  ipcMain.handle("apps:recents", () => getRecents());

  // Launch an entry (scanned or custom) by id.
  ipcMain.handle("apps:launch", async (_event, id: string) => {
    await launchApp(id);
  });

  /* -------------------------------------------------------------- window */

  // Hide the launcher window (e.g. on Escape).
  ipcMain.handle("window:hide", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.hide();
  });

  // Resize the window to fit the rendered content height (Spotlight-style).
  ipcMain.on("window:resize", (event, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const [w, current] = win.getSize();
    const h = Math.min(Math.max(Math.round(height), 80), 600);
    if (current === h) return;
    // setSize is ignored on a non-resizable window (Windows), so toggle the
    // flag around the call — the window must stay user-non-resizable.
    win.setResizable(true);
    win.setSize(w, h, false);
    win.setResizable(false);
  });

  // Open an http(s)/mailto link in the user's default browser / mail client.
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  });

  /* ------------------------------------------------------------ settings */

  ipcMain.handle("settings:open", (event) => {
    // Dismiss the launcher when opening settings (don't rely on blur, which is
    // suppressed while DevTools are open in dev).
    BrowserWindow.fromWebContents(event.sender)?.hide();
    openSettingsWindow();
  });
  ipcMain.handle("settings:get", () => getSettingsSnapshot());
  ipcMain.handle("settings:set", (_e, key: string, value: string) => {
    updateSetting(key, value);
  });
  ipcMain.handle("settings:hotkey:set", (_e, accel: string) => {
    const ok = setToggleHotkey(accel);
    if (ok) broadcastSettings();
    return ok;
  });
  ipcMain.handle("settings:openAtLogin:set", (_e, enabled: boolean) => {
    setOpenAtLogin(enabled);
    // Keep the tray's "开机自启" checkbox in sync with the settings window.
    refreshTrayMenu();
  });

  /* ----------------------------------------------------------- quick open */

  // Pick a file via the native dialog (for custom "path" entries).
  ipcMain.handle("dialog:pickPath", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = { properties: ["openFile"] as const };
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    return res.canceled ? "" : (res.filePaths[0] ?? "");
  });

  ipcMain.handle("quickopen:listCustom", () => getCustomApps());
  ipcMain.handle("quickopen:addCustom", async (_e, entry: NewCustomApp) => {
    // URL entries with no icon get the website's favicon for the search display.
    const icon =
      !entry.icon && entry.kind === "url"
        ? await fetchFavicon(entry.target)
        : entry.icon;
    const app: CustomApp = {
      ...entry,
      icon,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    addCustomApp(app);
    emitAppsChanged();
    return app;
  });
  ipcMain.handle("quickopen:updateCustom", async (_e, entry: CustomApp) => {
    const next =
      !entry.icon && entry.kind === "url"
        ? { ...entry, icon: await fetchFavicon(entry.target) }
        : entry;
    updateCustomApp(next);
    emitAppsChanged();
  });
  ipcMain.handle("quickopen:deleteCustom", (_e, id: string) => {
    deleteCustomApp(id);
    emitAppsChanged();
  });
  // Scanned apps (incl. hidden ones, with a flag) for the management list.
  ipcMain.handle("quickopen:listScanned", () => getScannedApps());
  ipcMain.handle(
    "quickopen:setAlias",
    (_e, appId: string, keywords: string) => {
      setAlias(appId, keywords);
      emitAppsChanged();
    },
  );
  // Hide/unhide a scanned app from search (persists across rescans).
  ipcMain.handle(
    "quickopen:hideScanned",
    (_e, appId: string, hidden: boolean) => {
      setAppHidden(appId, hidden);
      emitAppsChanged();
    },
  );
  // Sync: prune uninstalled custom entries + rescan installed apps.
  ipcMain.handle("quickopen:sync", () => syncQuickOpen());

  /* -------------------------------------------------------------- plugins */

  ipcMain.handle("plugins:list", () => discoverPlugins());
  ipcMain.handle(
    "plugins:setEnabled",
    async (_e, id: string, enabled: boolean) => {
      setPluginEnabled(id, enabled);
      await reloadPlugins(); // toggles take effect without a restart
    },
  );

  // Record that a view plugin was opened, so it ranks in "recently used".
  ipcMain.handle("plugins:use", (_e, id: string) => recordUsage(id));

  // Pop a view plugin out of the launcher into its own detached window.
  ipcMain.handle("plugins:detach", async (_e, id: string) => {
    recordUsage(id); // detaching counts as using it
    await openPluginWindow(id);
  });

  // Detached-window controls (sender is the plugin window's own renderer).
  ipcMain.handle("pluginWindow:getState", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && isPluginWindow(win)
      ? { alwaysOnTop: getPluginWindowOnTop(win) }
      : { alwaysOnTop: false };
  });
  ipcMain.handle("pluginWindow:setAlwaysOnTop", (event, on: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && isPluginWindow(win)) setPluginWindowAlwaysOnTop(win, on);
  });

  // Set a plugin's user-defined search keywords (so it can be searched/opened
  // by the user's own terms, like scanned-app aliases).
  ipcMain.handle(
    "plugins:setKeywords",
    (_e, id: string, keywords: string) => {
      setPluginKeywords(id, keywords);
    },
  );

  // Toggle whether a view plugin opens in its detached window by default.
  ipcMain.handle(
    "plugins:setOpenInWindow",
    (_e, id: string, on: boolean) => {
      setPluginOpenInWindow(id, on);
    },
  );

  // Persist a plugin's config (from the management UI), then push the new
  // effective values to the plugin's main-side init(ctx) subscribers and any
  // open view UI. Returns the resolved values so the UI can reflect coercion.
  ipcMain.handle(
    "plugins:setConfig",
    (_e, id: string, values: PluginConfigValues) => {
      setPluginConfig(id, values && typeof values === "object" ? values : {});
      notifyPluginConfigChanged(id);
      const resolved = getEffectivePluginConfig(id);
      notifyPluginWebviews(id, "plugin:config", resolved);
      return resolved;
    },
  );

  // Run enabled plugins' search hooks for the live query.
  ipcMain.handle("plugins:search", (_e, query: string) => searchPlugins(query));

  // Activate a plugin result, then hide the launcher (like apps:launch).
  ipcMain.handle(
    "plugins:execute",
    async (_e, pluginId: string, action: string) => {
      await executePlugin(pluginId, action);
      hideLauncherWindows();
    },
  );

  // The resolved 'light'/'dark' theme, for a plugin UI to style itself on load.
  // (Live changes arrive via the `plugin:theme` push from broadcastSettings.)
  ipcMain.handle("plugin:getTheme", () => getResolvedTheme());

  // A plugin UI reads its own effective config. The pluginId is derived from
  // the calling webview's committed origin (never trusted from the renderer).
  ipcMain.handle("plugin:getConfig", (event) => {
    const pluginId = pluginIdForWebContents(event.sender.id);
    if (!pluginId) throw new Error("unknown plugin host");
    return getEffectivePluginConfig(pluginId);
  });

  // RPC from a view plugin's UI. The pluginId is derived from the calling
  // webview's committed origin (never trusted from the renderer).
  ipcMain.handle("plugin:invoke", (event, method: string, args: unknown) => {
    const pluginId = pluginIdForWebContents(event.sender.id);
    if (!pluginId) throw new Error("unknown plugin host");
    return invokePlugin(pluginId, method, args);
  });

  // HTTP request from a plugin UI. The fetch runs here in main (so it isn't
  // bound by the plugin:// CSP). The pluginId is derived from the calling
  // webview's committed origin; baseURL defaults to the plugin's manifest
  // request.baseURL but the UI may override it per call.
  ipcMain.handle("plugin:request", (event, config: unknown) => {
    const pluginId = pluginIdForWebContents(event.sender.id);
    if (!pluginId) throw new Error("unknown plugin host");
    if (!config || typeof config !== "object") {
      throw new Error("invalid request config");
    }
    return runPluginHttpRequest(getPluginRequestDefaults(pluginId), config as any);
  });

  // A plugin UI asks to finish or go back. In a detached plugin window both
  // simply close that window; in the launcher they return it to the root view
  // (and close/hide the launcher).
  const closeOrExit = (event: Electron.IpcMainEvent) => {
    const host = hostWindowForWebContents(event.sender.id);
    if (host && isPluginWindow(host)) {
      host.close();
      return true;
    }
    return false;
  };
  ipcMain.on("plugin:close", (event) => {
    if (closeOrExit(event)) return;
    notifyLauncher("plugin:exit");
    hideLauncherWindows();
  });
  ipcMain.on("plugin:back", (event) => {
    if (closeOrExit(event)) return;
    notifyLauncher("plugin:exit");
  });

  // The launcher renderer toggles fixed plugin-mode sizing on enter/exit.
  ipcMain.on("window:setMode", (_e, mode: "root" | "plugin") => {
    setLauncherPluginMode(mode === "plugin");
  });
}
