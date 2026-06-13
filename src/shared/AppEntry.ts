/**
 * A launchable entry shown in the launcher: either a scanned application
 * shortcut or a user-defined custom entry (see {@link CustomApp}).
 */
export interface AppEntry {
  /** Stable unique id (scanned: the .lnk path; custom: a generated id). */
  id: string;
  /** Display name. */
  name: string;
  /** Path/target opened to launch (scanned: the .lnk path; custom: target). */
  path: string;
  /** Icon as a data URL (PNG), or '' if none could be resolved. */
  icon: string;
  /** Where this entry came from — used to visually distinguish custom ones. */
  source: "scanned" | "custom" | "plugin";
  /** Extra search keywords (space/comma separated), if any. */
  keywords?: string;
  /**
   * Precomputed pinyin of `name` — full pinyin and initials, space separated
   * (e.g. "weixin wx"), or "" for names with no Chinese characters. Matched
   * only when pinyin search is enabled; computed in main so the dictionary
   * never reaches the renderer bundle.
   */
  pinyin?: string;
  /** Management-only: whether this scanned app is hidden from search. */
  hidden?: boolean;
}

/**
 * A user-defined "quick open" entry — something the scanner didn't find. Opens
 * a filesystem path (exe/file/folder) or a URL.
 */
export interface CustomApp {
  /** Stable generated id. */
  id: string;
  /** Display name. */
  name: string;
  /** Path or URL to open. */
  target: string;
  /** How `target` is opened. */
  kind: "path" | "url";
  /** Icon as a data URL (PNG), or '' if none. */
  icon: string;
  /** Extra search keywords (space/comma separated). */
  keywords: string;
  /** Creation timestamp (ms). */
  createdAt: number;
}
