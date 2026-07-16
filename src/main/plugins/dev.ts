import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { getSetting, setSetting } from "../../core/database";
import { readPluginInfo } from "./discover";
import { clearDevPluginModules, reloadPlugins } from "./runtime";
import { sourcePluginsRoot } from "./paths";
import { notifyLauncher } from "../windows/mainWindow";
import { notifyPluginWindowHost } from "../windows/pluginWindow";
import type { PluginInfo } from "../../shared/PluginInfo";

/**
 * Plugin developer mode.
 *
 * When on, plugins are discovered and loaded straight from their SOURCE
 * directories — no `.orcpkg` pack/obfuscate step, no copy into the user plugin
 * dir. Editing the source and saving hot-reloads the plugin: the require cache
 * for its files is dropped, the runtime reloads, the launcher list refreshes,
 * and view plugins' webviews are told to reload.
 *
 * Roots that get watched/loaded:
 *  - In an unpackaged dev run, the repo's `plugins/` dir (auto-included).
 *  - Any external dirs the user adds by hand (persisted in `devPluginDirs`).
 *
 * In a packaged build developer mode defaults OFF and nothing is watched, so
 * end users are unaffected.
 */

const DEV_MODE_KEY = "devMode";
const DEV_DIRS_KEY = "devPluginDirs";

/** Whether the app runs unpackaged (repo `plugins/` is a dev root). */
export function isDevRun(): boolean {
  return !app.isPackaged;
}

/**
 * Developer mode on/off. Defaults ON in an unpackaged dev run (so `npm start`
 * loads source plugins out of the box) and OFF in a packaged build, until the
 * user explicitly toggles it (a stored value always wins).
 */
export function getDevMode(): boolean {
  const v = getSetting(DEV_MODE_KEY);
  if (v === "1") return true;
  if (v === "0") return false;
  return isDevRun();
}

export function setDevMode(on: boolean): void {
  setSetting(DEV_MODE_KEY, on ? "1" : "0");
}

/** User-added external plugin source dirs (absolute paths), de-duplicated. */
export function getDevPluginDirs(): string[] {
  const raw = getSetting(DEV_DIRS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.filter((d): d is string => typeof d === "string"))];
  } catch {
    return [];
  }
}

function saveDevPluginDirs(dirs: string[]): void {
  setSetting(DEV_DIRS_KEY, JSON.stringify([...new Set(dirs)]));
}

/**
 * Every source root that developer mode loads from: the repo `plugins/` dir
 * (only in a dev run) plus the user's external dirs. Empty when developer mode
 * is off. De-duplicated by resolved path.
 */
export function effectiveDevRoots(): string[] {
  if (!getDevMode()) return [];
  const roots = new Set<string>();
  if (isDevRun()) roots.add(path.resolve(sourcePluginsRoot()));
  for (const d of getDevPluginDirs()) roots.add(path.resolve(d));
  return [...roots];
}

/** Directory names never treated as plugins (or watched for changes). */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".vite",
  "dist",
  "out",
]);

/**
 * Discover developer-mode plugins across all effective roots. Each immediate
 * sub-directory containing a `plugin.json` becomes a `dev`-sourced PluginInfo,
 * loaded in place from its source dir. Later roots win on id collisions.
 */
export async function discoverDevPlugins(): Promise<PluginInfo[]> {
  const byId = new Map<string, PluginInfo>();
  for (const root of effectiveDevRoots()) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue; // missing/unreadable root — skip
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
      const dir = path.join(root, entry.name);
      const info = await readPluginInfo(dir, "dev");
      if (info) byId.set(info.id, info);
    }
  }
  return [...byId.values()];
}

/* ------------------------------------------------------------------ watching */

const watchers: FSWatcher[] = [];
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
// Wall-clock (ms) before which watcher events are ignored. Set just after
// watchers are (re)built: on some platforms establishing a recursive watch
// emits an initial event for the existing tree, which would otherwise fire a
// spurious hot reload at startup (re-running plugins' init and, e.g., starting
// a second clipboard poll loop). A short settle window suppresses that without
// affecting real edits, which never land in the first fraction of a second.
let watchReadyAt = 0;

/** Debounced hot-reload triggered by a file change under a watched root. */
function scheduleReload(): void {
  if (Date.now() < watchReadyAt) return; // ignore startup settle-window churn
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void hotReloadDevPlugins();
  }, 200);
}

/**
 * Perform a developer-mode hot reload: drop the require cache for source files,
 * rebuild the loaded plugin set, refresh the launcher list, and tell every dev
 * view plugin's webview to reload so UI edits show up.
 */
export async function hotReloadDevPlugins(): Promise<void> {
  const roots = effectiveDevRoots();
  const devPlugins = await discoverDevPlugins();
  clearDevPluginModules(
    roots,
    devPlugins.map((p) => p.id),
  );
  await reloadPlugins();
  // Refresh the plugins list everywhere it's shown.
  notifyLauncher("plugins:changed");
  // Ask any host currently showing a dev view plugin's UI to reload its webview
  // so HTML/JS edits take effect: the launcher (inline webview) + its detached
  // window, if open. Hosts ignore ids they aren't currently displaying.
  for (const p of devPlugins) {
    if (p.type !== "view") continue;
    notifyLauncher("plugin:reload", p.id);
    notifyPluginWindowHost(p.id, "plugin:reload");
  }
}

/** Close all active watchers. */
export function stopDevWatchers(): void {
  for (const w of watchers.splice(0)) {
    try {
      w.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * (Re)build filesystem watchers over the effective dev roots. Called on startup
 * and whenever the dir list or developer-mode toggle changes. A no-op (just
 * clears watchers) when developer mode is off.
 */
export function refreshDevWatchers(): void {
  stopDevWatchers();
  // Suppress the initial burst of events some platforms emit when a recursive
  // watch is established (see watchReadyAt). Real edits arrive well after this.
  watchReadyAt = Date.now() + 800;
  for (const root of effectiveDevRoots()) {
    try {
      // `recursive` is supported on Windows and macOS; a change anywhere under
      // a plugin's source tree triggers the debounced reload.
      const w = watch(root, { recursive: true }, (_event, filename) => {
        if (filename) {
          const first = String(filename).split(/[\\/]/)[0];
          if (IGNORED_DIRS.has(first)) return; // ignore build/vcs churn
        }
        scheduleReload();
      });
      watchers.push(w);
    } catch (err) {
      console.error(`[plugins] dev watch 失败 ${root}:`, err);
    }
  }
}

/* ------------------------------------------------------------- dir management */

/** True if `dir` has at least one immediate sub-dir with a `plugin.json`. */
async function hasPluginSubdir(dir: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
    const ok = await fs
      .access(path.join(dir, entry.name, "plugin.json"))
      .then(() => true)
      .catch(() => false);
    if (ok) return true;
  }
  return false;
}

/**
 * Add an external plugin source dir. Rejects a dir that contains no plugin
 * (no immediate sub-dir with a `plugin.json`) so a mistaken pick fails loudly.
 * Rebuilds watchers, reloads, and notifies the launcher. Returns the new list.
 */
export async function addDevPluginDir(dir: string): Promise<string[]> {
  const resolved = path.resolve(dir);
  if (!(await hasPluginSubdir(resolved))) {
    throw new Error("该目录下没有找到任何插件（缺少含 plugin.json 的子目录）");
  }
  const dirs = getDevPluginDirs();
  if (!dirs.some((d) => path.resolve(d) === resolved)) {
    dirs.push(resolved);
    saveDevPluginDirs(dirs);
  }
  refreshDevWatchers();
  await hotReloadDevPlugins();
  return getDevPluginDirs();
}

/** Remove an external dir from the dev roots. Rebuilds watchers + reloads. */
export async function removeDevPluginDir(dir: string): Promise<string[]> {
  const resolved = path.resolve(dir);
  const dirs = getDevPluginDirs().filter((d) => path.resolve(d) !== resolved);
  saveDevPluginDirs(dirs);
  refreshDevWatchers();
  await hotReloadDevPlugins();
  return getDevPluginDirs();
}

/** Toggle developer mode, then rebuild watchers and reload. */
export async function setDevModeAndReload(on: boolean): Promise<void> {
  setDevMode(on);
  refreshDevWatchers();
  await hotReloadDevPlugins();
}

/** Snapshot of dev state for the settings UI. */
export function getDevState(): {
  devMode: boolean;
  dirs: string[];
  isDev: boolean;
} {
  return { devMode: getDevMode(), dirs: getDevPluginDirs(), isDev: isDevRun() };
}
