/** App-wide settings shared between main and renderer. */

export type Theme = "system" | "light" | "dark";

export interface SettingsSnapshot {
  theme: Theme;
  toggleHotkey: string;
  /** Whether the app launches automatically at OS login. */
  openAtLogin: boolean;
  /** Whether typing pinyin (full or initials) matches Chinese app names. */
  pinyinSearch: boolean;
}

/**
 * Plugin developer-mode state. When on, plugins are loaded straight from their
 * source directories (no pack/obfuscate/install step) and hot-reloaded on save.
 * In a dev run (`!app.isPackaged`) the repo's `plugins/` dir is included
 * automatically; `dirs` holds any extra source dirs the user adds by hand.
 */
export interface DevModeState {
  /** Master switch for developer mode. */
  devMode: boolean;
  /** Extra external plugin source directories (absolute paths). */
  dirs: string[];
  /** Whether the app is running unpackaged (repo `plugins/` auto-included). */
  isDev: boolean;
}
