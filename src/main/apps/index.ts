import { BrowserWindow, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { scanApps } from "./scanner";
import {
  getCachedApps,
  saveApps,
  recordUsage,
  getRecentUsage,
  getCustomApps,
  deleteCustomApp,
} from "../../core/database";
import { discoverPlugins } from "../plugins/discover";
import { pinyinForName } from "./pinyin";
import type { AppEntry } from "../../shared/AppEntry";

/**
 * Orchestrates the launcher entry list: scanned apps (served from the SQLite
 * cache, refreshed in the background) merged with user-defined custom entries.
 */

let refreshing = false;

/** Cached scanned apps with precomputed pinyin attached for search. */
function cachedEntries(): AppEntry[] {
  return getCachedApps().map((a) => ({ ...a, pinyin: pinyinForName(a.name) }));
}

/** User-defined quick-open entries, shaped as launcher entries. */
function customEntries(): AppEntry[] {
  return getCustomApps().map((c) => ({
    id: c.id,
    name: c.name,
    path: c.target,
    icon: c.icon,
    source: "custom" as const,
    keywords: c.keywords || undefined,
    pinyin: pinyinForName(c.name),
  }));
}

/** The full launcher list: scanned apps + custom entries, all with pinyin. */
function mergedEntries(): AppEntry[] {
  return [...cachedEntries(), ...customEntries()];
}

export async function getApps(): Promise<AppEntry[]> {
  const cached = getCachedApps();
  const hasStoreApps = cached.some((a) =>
    a.path.startsWith("shell:AppsFolder\\"),
  );
  if (cached.length > 0 && hasStoreApps) {
    void refreshInBackground(); // update cache for next time
    return mergedEntries();
  }
  // First run, or a cache that predates Store-app support: scan synchronously
  // so the UI has the full list (including Store apps) right away. Afterwards
  // the cache has Store apps, so subsequent launches take the fast path above.
  const apps = await scanApps();
  saveApps(apps);
  return mergedEntries();
}

async function refreshInBackground(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const apps = await scanApps();
    saveApps(apps);
    const merged = mergedEntries();
    // Push the fresh list to any open window so it updates live.
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("apps:updated", merged);
    }
  } catch (err) {
    console.error("App rescan failed:", err);
  } finally {
    refreshing = false;
  }
}

/**
 * Most recently used entries for the default view, newest first — scanned apps,
 * custom entries, AND view plugins, all ranked by real usage recency. An entry
 * only appears here once it has actually been launched/opened, so nothing is
 * pinned to the front just for existing.
 */
export async function getRecents(limit = 12): Promise<AppEntry[]> {
  const usage = getRecentUsage(50);
  if (usage.length === 0) return [];

  // Resolve each used id to its display entry. getCachedApps() already drops
  // hidden apps, so a hidden app's usage row simply finds no entry and is
  // skipped. Plugin ids resolve against enabled view plugins.
  const byId = new Map<string, AppEntry>();
  for (const a of cachedEntries()) byId.set(a.id, a);
  for (const c of customEntries()) byId.set(c.id, c);
  for (const p of await discoverPlugins()) {
    if (!p.enabled || p.type !== "view") continue;
    byId.set(p.id, {
      id: p.id,
      name: p.name,
      path: "",
      icon: p.icon ?? "",
      source: "plugin",
    });
  }

  const out: AppEntry[] = [];
  for (const u of usage) {
    const entry = byId.get(u.id);
    if (entry) out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

/** Push the current merged entry list to all windows (after custom edits). */
export function emitAppsChanged(): void {
  const merged = mergedEntries();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("apps:updated", merged);
  }
}

/**
 * Re-sync the launcher: drop custom "path" entries whose target no longer
 * exists (uninstalled / deleted), then rescan installed apps so the scanned
 * list reflects current installs. Returns how many custom entries were removed.
 */
export async function syncQuickOpen(): Promise<{ removedCustom: number }> {
  let removedCustom = 0;
  for (const c of getCustomApps()) {
    // URLs can't be checked locally; only prune filesystem targets that vanished.
    if (c.kind === "path" && !existsSync(c.target)) {
      deleteCustomApp(c.id);
      removedCustom++;
    }
  }
  try {
    saveApps(await scanApps());
  } catch (err) {
    console.error("Quick-open sync rescan failed:", err);
  }
  emitAppsChanged();
  return { removedCustom };
}

/** Hide the frameless launcher window(s), leaving any settings window open. */
export function hideLauncherWindows(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    // Only the frameless launcher should hide; leave the settings window open.
    if (!win.isVisible()) continue;
    if (win.webContents.getURL().includes("#/settings")) continue;
    win.hide();
  }
}

/** Launch the entry with the given id (scanned or custom), then hide. */
export async function launchApp(id: string): Promise<void> {
  const custom = getCustomApps().find((c) => c.id === id);
  if (custom) {
    recordUsage(id);
    if (custom.kind === "url") {
      await shell.openExternal(custom.target);
    } else {
      await shell.openPath(custom.target);
    }
    hideLauncherWindows();
    return;
  }

  const target = getCachedApps().find((a) => a.id === id);
  if (!target) return;
  recordUsage(id); // track recency before launching
  if (target.path.startsWith("shell:AppsFolder\\")) {
    // Microsoft Store / UWP app — launched through the apps-folder namespace.
    spawn("explorer.exe", [target.path], { detached: true }).unref();
  } else {
    await shell.openPath(target.path);
  }
  hideLauncherWindows();
}
