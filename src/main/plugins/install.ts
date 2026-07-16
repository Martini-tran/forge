import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { net } from "electron";
import {
  getSetting,
  setSetting,
  deletePluginData,
} from "../../core/database";
import { discoverPlugins } from "./discover";
import { reloadPlugins } from "./runtime";
import {
  userPluginsRoot,
  bundledPluginsRoot,
  sourcePluginsRoot,
  npmPluginsRoot,
} from "./paths";
import { getDevMode, isDevRun } from "./dev";
import {
  validatePackage,
  PACKAGE_EXT,
  PLUGIN_ID_RE,
} from "../../shared/PluginPackage";
import type { PluginPackage } from "../../shared/PluginPackage";
import type { PluginInfo } from "../../shared/PluginInfo";

const gunzip = promisify(zlib.gunzip);
const DEFAULT_NPM_REGISTRY = "https://registry.npmmirror.com";
const NPM_PACKAGE_SPEC_RE =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._~+-]*)?$/i;

/**
 * Plugin install/uninstall + first-run seeding.
 *
 * Packages are `gzip(JSON PluginPackage)` (see PluginPackage.ts). Installing
 * extracts the (already-obfuscated) files into `<userData>/plugins/<id>/`;
 * uninstalling removes that directory and clears the plugin's stored state.
 * Built-in plugins ship as `.orcpkg` seeds and are installed on first run.
 */

// DB keys recording seed bookkeeping (kept out of deletePluginData's wipe so a
// user's uninstall decision survives a reinstall-on-startup).
const seededVersionKey = (id: string) => `plugin:${id}:seededVersion`;
const uninstalledKey = (id: string) => `plugin:${id}:uninstalled`;

/** Read + decompress + structurally validate a `.orcpkg` file. */
export async function readPackage(filePath: string): Promise<PluginPackage> {
  const raw = await fs.readFile(filePath);
  let json: unknown;
  try {
    json = JSON.parse((await gunzip(raw)).toString("utf8"));
  } catch {
    throw new Error("无法解析插件包（已损坏或格式不正确）");
  }
  return validatePackage(json);
}

/** Write a validated package's files into a freshly-created plugin directory. */
async function writePackageTo(pkg: PluginPackage, dir: string): Promise<void> {
  // Write to a sibling temp dir first, then swap in atomically so a failed or
  // partial extraction never leaves a half-written plugin behind.
  const tmp = `${dir}.installing-${process.pid}`;
  await fs.rm(tmp, { recursive: true, force: true });
  for (const [rel, b64] of Object.entries(pkg.files)) {
    const target = path.join(tmp, ...rel.split("/"));
    // Defence in depth: validatePackage already rejected traversal, but verify
    // the resolved path stays inside the temp dir before writing.
    const within = path.relative(tmp, target);
    if (within.startsWith("..") || path.isAbsolute(within)) {
      throw new Error(`非法的文件路径：${rel}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(b64, "base64"));
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rename(tmp, dir);
}

/** Install (or overwrite) a validated package into the user plugins dir. */
async function installPackage(pkg: PluginPackage): Promise<PluginInfo> {
  const id = pkg.manifest.id;
  await fs.mkdir(userPluginsRoot(), { recursive: true });
  await writePackageTo(pkg, path.join(userPluginsRoot(), id));

  // Installing clears any prior "user uninstalled this" tombstone.
  if (getSetting(uninstalledKey(id))) {
    deletePluginData(id); // also drops the uninstalled flag (see database.ts)
  }
  await reloadPlugins();

  const info = (await discoverPlugins()).find((p) => p.id === id);
  if (!info) throw new Error(`安装后未能发现插件：${id}`);
  return info;
}

/** Install a plugin from a user-selected `.orcpkg` file. */
export async function installPluginFromFile(
  filePath: string,
): Promise<PluginInfo> {
  return installPackage(await readPackage(filePath));
}

/**
 * Install a plugin from a remote marketplace URL. Downloads the `.orcpkg`
 * bytes (via Electron's net stack, so it follows the app's proxy/TLS config),
 * optionally verifies their SHA-256 against the value the backend returned,
 * then reuses the on-disk install path (`readPackage` gunzips + validates).
 *
 * The downloaded artifact MUST be a `.orcpkg` — `gzip(JSON PluginPackage)`;
 * anything else is rejected by `validatePackage` inside `readPackage`.
 */
export async function installPluginFromUrl(
  url: string,
  expectedSha256?: string,
): Promise<PluginInfo> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("非法的下载地址");
  }
  const res = await net.fetch(url);
  if (!res.ok) {
    throw new Error(`下载失败（HTTP ${res.status}）`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  if (expectedSha256) {
    const actual = crypto.createHash("sha256").update(buf).digest("hex");
    if (actual.toLowerCase() !== expectedSha256.trim().toLowerCase()) {
      throw new Error("安装包校验失败（SHA-256 不匹配）");
    }
  }

  // Stage to a unique temp file, then reuse the file-based install path.
  const tmp = path.join(
    os.tmpdir(),
    `orccode-download-${process.pid}-${Date.now()}${PACKAGE_EXT}`,
  );
  await fs.writeFile(tmp, buf);
  try {
    return await installPluginFromFile(tmp);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function packageNameFromSpec(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed.startsWith("@")) {
    const slash = trimmed.indexOf("/");
    const versionAt = trimmed.indexOf("@", slash + 1);
    return versionAt === -1 ? trimmed : trimmed.slice(0, versionAt);
  }
  return trimmed.split("@")[0];
}

function validateNpmPackageSpec(spec: string): string {
  const trimmed = spec.trim();
  if (!NPM_PACKAGE_SPEC_RE.test(trimmed)) {
    throw new Error("请输入合法的 npm 包名，例如 rubick-example 或 @scope/plugin");
  }
  return trimmed;
}

async function ensureNpmRoot(): Promise<void> {
  const root = npmPluginsRoot();
  await fs.mkdir(root, { recursive: true });
  const pkgPath = path.join(root, "package.json");
  const exists = await fs
    .access(pkgPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    await fs.writeFile(
      pkgPath,
      JSON.stringify({ private: true, dependencies: {} }, null, 2),
      "utf8",
    );
  }
}

async function runNpm(args: string[]): Promise<string> {
  await ensureNpmRoot();
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, {
      cwd: npmPluginsRoot(),
      windowsHide: true,
      shell: false,
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.on("data", (data) => {
      output += data.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output || `npm exited with code ${code}`));
    });
  });
}

/** Install or upgrade a plugin package from npm into the npm-managed tree. */
export async function installPluginFromNpm(
  spec: string,
  registry = DEFAULT_NPM_REGISTRY,
): Promise<PluginInfo> {
  const safeSpec = validateNpmPackageSpec(spec);
  const packageName = packageNameFromSpec(safeSpec);
  await runNpm([
    "install",
    safeSpec.includes("@", safeSpec.startsWith("@") ? safeSpec.indexOf("/") : 0)
      ? safeSpec
      : `${safeSpec}@latest`,
    "--save",
    `--registry=${registry}`,
  ]);
  await reloadPlugins();

  const info = (await discoverPlugins()).find(
    (p) => p.source === "npm" && p.packageName === packageName,
  );
  if (!info) {
    throw new Error(`已安装 ${packageName}，但没有发现可用的 plugin.json`);
  }
  return info;
}

/**
 * Uninstall a plugin: remove its directory and wipe its stored state. Only
 * directories inside the user plugins root are removable (guards against a
 * crafted id escaping the root). A tombstone is recorded so first-run seeding
 * won't silently reinstall a built-in the user removed.
 */
export async function uninstallPlugin(id: string): Promise<void> {
  if (!PLUGIN_ID_RE.test(id)) throw new Error(`非法的插件 id：${id}`);
  const info = (await discoverPlugins()).find((p) => p.id === id);
  if (info?.source === "npm") {
    if (!info.packageName) throw new Error(`缺少 npm 包名：${id}`);
    await runNpm(["uninstall", info.packageName, "--save"]);
    deletePluginData(id);
    await reloadPlugins();
    return;
  }

  const root = userPluginsRoot();
  const dir = path.join(root, id);

  // Containment check: realpath the root, then ensure dir resolves inside it.
  const realRoot = await fs.realpath(root).catch(() => root);
  let realDir = dir;
  try {
    realDir = await fs.realpath(dir);
  } catch {
    /* dir may be gone already — fall through, the rm below is a no-op */
  }
  if (realDir !== path.join(realRoot, id) && !realDir.startsWith(realRoot + path.sep)) {
    throw new Error("拒绝删除插件目录之外的路径");
  }

  await fs.rm(dir, { recursive: true, force: true });
  deletePluginData(id); // clears enabled/keywords/config/openInWindow/seeded…
  setSetting(uninstalledKey(id), "1"); // …then record the tombstone
  await reloadPlugins();
}

/* ------------------------------------------------------------- first-run seed */

/** Greater-than compare of two dotted version strings (numeric, lenient). */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Install a single seed package unless the user uninstalled it or it's current. */
async function seedOne(pkg: PluginPackage): Promise<void> {
  const id = pkg.manifest.id;
  if (getSetting(uninstalledKey(id))) return; // user removed it — respect that

  const dir = path.join(userPluginsRoot(), id);
  const exists = await fs
    .access(dir)
    .then(() => true)
    .catch(() => false);

  if (exists) {
    const seeded = getSetting(seededVersionKey(id));
    // Only overwrite when we're upgrading our own seed to a newer version.
    if (!seeded || !isNewer(pkg.manifest.version, seeded)) return;
  }

  await writePackageTo(pkg, dir);
  setSetting(seededVersionKey(id), pkg.manifest.version);
}

/**
 * Seed shipped built-in plugins into the user plugins dir on startup. Reads
 * pre-packed `.orcpkg` bundles; in dev (no bundles built yet) falls back to
 * copying the raw `plugins/<id>` source so the app works out of the box.
 * Must run before loadPlugins().
 */
export async function seedBundledPlugins(): Promise<void> {
  await fs.mkdir(userPluginsRoot(), { recursive: true });

  const bundledDir = bundledPluginsRoot();
  let packs: string[] = [];
  try {
    packs = (await fs.readdir(bundledDir)).filter((f) =>
      f.toLowerCase().endsWith(PACKAGE_EXT),
    );
  } catch {
    /* no bundles dir — handled by the dev fallback below */
  }

  if (packs.length > 0) {
    for (const file of packs) {
      try {
        const pkg = await readPackage(path.join(bundledDir, file));
        await seedOne(pkg);
      } catch (err) {
        console.error(`[plugins] 种子包安装失败 ${file}:`, err);
      }
    }
    return;
  }

  // Dev fallback: copy raw source dirs (unobfuscated) so dev runs work without
  // a prior `npm run pack:bundled`.
  await seedFromSource();
}

/** Dev-only: copy `plugins/<id>` source dirs into the user dir if missing. */
async function seedFromSource(): Promise<void> {
  // When developer mode is on, repo plugins are loaded IN PLACE from source
  // (see dev.ts) — copying them here would just shadow the live source and
  // resurrect the "copied once, never updates" trap. Skip the copy entirely.
  if (isDevRun() && getDevMode()) return;

  const src = sourcePluginsRoot();
  let entries;
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return; // no source plugins either — nothing to seed
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (getSetting(uninstalledKey(id))) continue;
    const dest = path.join(userPluginsRoot(), id);
    const exists = await fs
      .access(dest)
      .then(() => true)
      .catch(() => false);
    if (exists) continue;
    try {
      await fs.cp(path.join(src, id), dest, { recursive: true });
    } catch (err) {
      console.error(`[plugins] 源插件拷贝失败 ${id}:`, err);
    }
  }
}
