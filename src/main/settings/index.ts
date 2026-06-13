import { app, BrowserWindow, nativeTheme, webContents } from "electron";
import { getSetting, setSetting } from "../../core/database";
import type { Theme, SettingsSnapshot } from "../../shared/Settings";

/**
 * Typed access to persisted app settings, with defaults. Writes broadcast a
 * `settings:changed` event so every open window (launcher + settings) can react
 * live (e.g. re-apply the theme).
 */

const DEFAULT_HOTKEY = "Alt+Space";

export function getTheme(): Theme {
  const v = getSetting("theme");
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** Resolve the theme to a concrete 'light'/'dark' (following the OS for 'system'). */
export function getResolvedTheme(): "light" | "dark" {
  const theme = getTheme();
  if (theme === "system") {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }
  return theme;
}

export function getToggleHotkey(): string {
  return getSetting("toggleHotkey") || DEFAULT_HOTKEY;
}

/** Whether pinyin (full + initials) matches Chinese names in search. */
export function getPinyinSearch(): boolean {
  return getSetting("pinyinSearch") === "1";
}

/** Whether the app is registered to launch at OS login (OS is the source of truth). */
export function getOpenAtLogin(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

/** Register/unregister the app to launch at OS login, then notify all windows.
 *  Launches hidden (a `--hidden` arg the startup checks) so the panel doesn't
 *  pop up at every login — it waits for the global hotkey. */
export function setOpenAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true, // macOS
    args: ['--hidden'], // Windows/Linux: checked in createMainWindow
  });
  broadcastSettings();
}

/** Everything the renderer needs on load, merged over defaults. */
export function getSettingsSnapshot(): SettingsSnapshot {
  return {
    theme: getTheme(),
    toggleHotkey: getToggleHotkey(),
    openAtLogin: getOpenAtLogin(),
    pinyinSearch: getPinyinSearch(),
  };
}

/** Persist a setting and notify all windows. */
export function updateSetting(key: string, value: string): void {
  setSetting(key, value);
  broadcastSettings();
}

/** Push the current settings snapshot to every open window. */
export function broadcastSettings(): void {
  const snapshot = getSettingsSnapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("settings:changed", snapshot);
  }
  // Plugin UIs run in sandboxed <webview> guests (separate webContents that
  // aren't BrowserWindows), so push the resolved theme to them directly so
  // their styling can follow the app theme live.
  const resolved = getResolvedTheme();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getType() === "webview") wc.send("plugin:theme", resolved);
  }
}
