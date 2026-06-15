import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getPluginStates,
  setPluginState,
  getPluginKeywords,
  getPluginConfig,
  getPluginOpenInWindow,
} from "../../core/database";
import { pinyinForName } from "../apps/pinyin";
import { resolvePluginConfig } from "../../shared/PluginConfig";
import { userPluginsRoot } from "./paths";
import type { PluginManifest } from "../../shared/PluginManifest";
import type { PluginInfo } from "../../shared/PluginInfo";

/**
 * Discover installed plugins by reading `<userData>/plugins/<id>/plugin.json`.
 * This only lists and tracks management state (enabled, keywords, config) —
 * loading/executing plugin code is the runtime's job (see runtime.ts). Plugins
 * are seeded here on first run and can be installed/uninstalled at runtime
 * (see install.ts).
 */

function pluginsRoot(): string {
  return userPluginsRoot();
}

const ICON_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

/** Read a plugin's icon file into a data URI, or undefined if missing. */
async function readIcon(
  dir: string,
  icon: string,
): Promise<string | undefined> {
  const mime = ICON_MIME[path.extname(icon).toLowerCase()];
  if (!mime) return undefined;
  try {
    const buf = await fs.readFile(path.join(dir, icon));
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function discoverPlugins(): Promise<PluginInfo[]> {
  let entries;
  try {
    entries = await fs.readdir(pluginsRoot(), { withFileTypes: true });
  } catch {
    return []; // plugins/ missing
  }

  const states = getPluginStates();
  const keywords = getPluginKeywords();
  const openInWindow = getPluginOpenInWindow();
  const out: PluginInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(pluginsRoot(), entry.name);
    let manifest: PluginManifest;
    try {
      const raw = await fs.readFile(path.join(dir, "plugin.json"), "utf8");
      manifest = JSON.parse(raw) as PluginManifest;
    } catch {
      continue; // missing / invalid manifest
    }
    if (!manifest.id || !manifest.name) continue;
    const type = manifest.type === "view" ? "view" : "inline";
    if (type === "view" && !manifest.ui) {
      console.error(`[plugins] ${manifest.id}: view plugin missing "ui"`);
      continue;
    }
    const icon = manifest.icon ? await readIcon(dir, manifest.icon) : undefined;
    out.push({
      ...manifest,
      type,
      icon, // resolved to a data URI (or undefined)
      enabled: states[manifest.id] ?? true,
      userKeywords: keywords[manifest.id] ?? "",
      pinyin: pinyinForName(manifest.name),
      dir,
      // Everything lives in the writable user dir, so every plugin is
      // uninstallable (built-ins are seeded there and can be removed too).
      removable: true,
      openInWindow: openInWindow[manifest.id] ?? false,
      configValues: resolvePluginConfig(
        manifest.config,
        getPluginConfig(manifest.id),
      ),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  setPluginState(id, enabled);
}
