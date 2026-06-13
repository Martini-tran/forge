import { promises as fs } from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import type { AppEntry } from "../../shared/AppEntry";
import { scanStoreApps } from "./storeApps";

/**
 * Scan the Windows Start Menu and Desktop for launchable application shortcuts
 * (.lnk), resolving each to a name, launch path and icon.
 */

function startMenuDirs(): string[] {
  const dirs: string[] = [];
  const sub = "Microsoft/Windows/Start Menu/Programs";
  if (process.env.ProgramData) {
    dirs.push(path.join(process.env.ProgramData, sub)); // all users
  }
  if (process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, sub)); // current user
  }
  return dirs;
}

function desktopDirs(): string[] {
  const dirs: string[] = [];
  try {
    dirs.push(app.getPath("desktop")); // current user desktop
  } catch {
    // ignore — not available on some platforms
  }
  if (process.env.PUBLIC) {
    dirs.push(path.join(process.env.PUBLIC, "Desktop")); // shared desktop
  }
  return dirs;
}

/** Recursively collect all .lnk files under `dir`. */
async function collectShortcuts(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // directory missing / inaccessible
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectShortcuts(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".lnk")) {
      out.push(full);
    }
  }
}

// Skip obvious non-app shortcuts (uninstallers, docs, links, …).
const SKIP =
  /uninstall|卸载|setup|installer|安装|readme|help|帮助|manual|文档|website|官网|homepage|repair|修复|change log|release notes/i;

export async function scanApps(): Promise<AppEntry[]> {
  const shortcuts: string[] = [];
  for (const dir of [...startMenuDirs(), ...desktopDirs()]) {
    await collectShortcuts(dir, shortcuts);
  }

  const seen = new Set<string>();
  const apps: AppEntry[] = [];

  for (const lnk of shortcuts) {
    const name = path.basename(lnk, path.extname(lnk));
    if (SKIP.test(name)) continue;

    // Resolve the shortcut; keep only those pointing at an executable.
    let target = "";
    try {
      target = shell.readShortcutLink(lnk).target;
    } catch {
      continue; // not a valid shortcut (or non-Windows)
    }
    if (!target.toLowerCase().endsWith(".exe")) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue; // dedupe by display name
    seen.add(key);

    let icon = "";
    try {
      // Resolve the icon from the target executable, NOT the .lnk: getFileIcon
      // on a shortcut returns the generic shortcut placeholder, identical for
      // every app. The target .exe yields the real, distinct icon.
      const image = await app.getFileIcon(target, { size: "large" });
      icon = image.toDataURL();
    } catch {
      // leave icon empty
    }

    apps.push({ id: lnk, name, path: lnk, icon, source: "scanned" });
  }

  // Microsoft Store / UWP apps (not found as .lnk → .exe shortcuts).
  try {
    for (const storeApp of await scanStoreApps()) {
      const key = storeApp.name.toLowerCase();
      if (seen.has(key)) continue; // a Win32 shortcut already covers it
      seen.add(key);
      apps.push(storeApp);
    }
  } catch (err) {
    console.error("Store app scan failed:", err);
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}
