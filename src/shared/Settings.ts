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
