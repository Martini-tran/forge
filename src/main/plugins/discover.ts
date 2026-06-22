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
import { npmPluginsNodeModulesRoot, userPluginsRoot } from "./paths";
import type {
  NpmPluginManifest,
  PluginManifest,
} from "../../shared/PluginManifest";
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

function npmRoot(): string {
  return npmPluginsNodeModulesRoot();
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
  if (/^https?:\/\//i.test(icon) || icon.startsWith("data:")) return icon;
  const mime = ICON_MIME[path.extname(icon).toLowerCase()];
  if (!mime) return undefined;
  try {
    const buf = await fs.readFile(path.join(dir, icon));
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function normalizeNpmManifest(raw: NpmPluginManifest): PluginManifest | null {
  const id = (raw.id || raw.name)?.replace(/^@/, "").replace(/\//g, "__");
  const name = raw.pluginName || raw.name;
  const version = raw.version || "0.0.0";
  if (!id || !name) return null;

  const keywords = [
    ...(raw.keywords ?? []),
    ...((raw.features ?? []).flatMap((f) => [
      ...(f.cmds ?? []),
      f.code ?? "",
      f.explain ?? "",
    ])),
  ].filter(Boolean);

  if (raw.id || raw.type || raw.entry || raw.ui) {
    return {
      ...raw,
      id,
      name,
      version,
      icon: raw.icon || raw.logo,
      keywords,
    } as PluginManifest;
  }

  const rubickType = String(raw.pluginType ?? "").toLowerCase();
  const main = raw.main;
  return {
    id,
    name,
    version,
    type: rubickType === "adapter" ? "inline" : "view",
    ui: rubickType === "adapter" ? undefined : main,
    entry: rubickType === "adapter" ? main : undefined,
    icon: raw.logo,
    description: raw.description,
    keywords,
  };
}

async function readPluginInfo(
  dir: string,
  source: "package" | "npm",
  packageName?: string,
): Promise<PluginInfo | null> {
  let manifest: PluginManifest | null;
  try {
    const raw = await fs.readFile(path.join(dir, "plugin.json"), "utf8");
    const parsed = JSON.parse(raw) as NpmPluginManifest;
    manifest = source === "npm"
      ? normalizeNpmManifest(parsed)
      : (parsed as PluginManifest);
  } catch {
    return null; // missing / invalid manifest
  }

  if (!manifest?.id || !manifest.name) return null;
  const type = manifest.type === "view" ? "view" : "inline";
  if (type === "view" && !manifest.ui) {
    console.error(`[plugins] ${manifest.id}: view plugin missing "ui"`);
    return null;
  }

  const states = getPluginStates();
  const keywords = getPluginKeywords();
  const openInWindow = getPluginOpenInWindow();
  const icon = manifest.icon ? await readIcon(dir, manifest.icon) : undefined;

  return {
    ...manifest,
    type,
    icon, // resolved to a data URI/URL (or undefined)
    enabled: states[manifest.id] ?? true,
    userKeywords: keywords[manifest.id] ?? "",
    pinyin: pinyinForName(manifest.name),
    dir,
    source,
    packageName,
    removable: true,
    openInWindow: openInWindow[manifest.id] ?? false,
    configValues: resolvePluginConfig(
      manifest.config,
      getPluginConfig(manifest.id),
    ),
  };
}

async function discoverDirectoryPlugins(root: string): Promise<PluginInfo[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: PluginInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const info = await readPluginInfo(path.join(root, entry.name), "package");
    if (info) out.push(info);
  }
  return out;
}

async function discoverNpmPlugins(): Promise<PluginInfo[]> {
  let entries;
  try {
    entries = await fs.readdir(npmRoot(), { withFileTypes: true });
  } catch {
    return [];
  }

  const out: PluginInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    if (entry.name.startsWith("@")) {
      const scopeDir = path.join(npmRoot(), entry.name);
      const scoped = await fs.readdir(scopeDir, { withFileTypes: true }).catch(
        () => [],
      );
      for (const pkg of scoped) {
        if (!pkg.isDirectory()) continue;
        const packageName = `${entry.name}/${pkg.name}`;
        const info = await readPluginInfo(
          path.join(scopeDir, pkg.name),
          "npm",
          packageName,
        );
        if (info) out.push(info);
      }
      continue;
    }

    const info = await readPluginInfo(
      path.join(npmRoot(), entry.name),
      "npm",
      entry.name,
    );
    if (info) out.push(info);
  }
  return out;
}

export async function discoverPlugins(): Promise<PluginInfo[]> {
  const out = [
    ...(await discoverDirectoryPlugins(pluginsRoot())),
    ...(await discoverNpmPlugins()),
  ];

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  setPluginState(id, enabled);
}
