import type { PluginManifest } from "./PluginManifest";

/**
 * On-disk format of a distributable plugin package (`.orcpkg`).
 *
 * A package is `gzip(JSON.stringify(PluginPackage))` — a single, compressed
 * file. JS assets inside `files` are obfuscated at pack time (see
 * scripts/pack-plugin.mjs) so the plugin's code is never shipped in plaintext.
 * The manifest is kept readable so the host can validate/preview a package
 * before installing it.
 */
export interface PluginPackage {
  /** Format version, bumped on incompatible changes. */
  format: number;
  /** The plugin's manifest (same shape as its `plugin.json`). */
  manifest: PluginManifest;
  /**
   * Map of plugin-relative path → base64-encoded file contents. Paths use
   * forward slashes (e.g. `ui/ui.js`); JS files are pre-obfuscated.
   */
  files: Record<string, string>;
}

/** Current package format version emitted by the packer. */
export const PACKAGE_FORMAT = 1;

/** File extension for plugin packages. */
export const PACKAGE_EXT = ".orcpkg";

/** Allowed plugin id shape — also the on-disk directory name. */
export const PLUGIN_ID_RE = /^[a-z0-9._-]+$/i;

/**
 * Reject a package-relative file path that could escape the target directory:
 * absolute paths, Windows drive letters, UNC, or any `..` traversal segment.
 * Returns true when the path is safe to write under the plugin dir.
 */
export function isSafePackagePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false;
  // Normalise separators, then reject absolute / drive / traversal forms.
  const norm = p.replace(/\\/g, "/");
  if (norm.startsWith("/")) return false; // absolute (posix)
  if (/^[a-z]:/i.test(norm)) return false; // drive letter (windows)
  if (norm.startsWith("//")) return false; // UNC
  return !norm.split("/").some((seg) => seg === ".." || seg === ".");
}

/**
 * Structurally validate a parsed package. Throws with a descriptive message on
 * the first problem; returns the value typed as PluginPackage on success.
 */
export function validatePackage(value: unknown): PluginPackage {
  if (!value || typeof value !== "object") {
    throw new Error("包内容不是对象");
  }
  const pkg = value as Partial<PluginPackage>;
  if (pkg.format !== PACKAGE_FORMAT) {
    throw new Error(`不支持的包格式版本：${String(pkg.format)}`);
  }
  const m = pkg.manifest;
  if (!m || typeof m !== "object") throw new Error("包缺少 manifest");
  if (!m.id || !PLUGIN_ID_RE.test(m.id)) {
    throw new Error(`非法的插件 id：${String(m.id)}`);
  }
  if (!m.name || !m.version) throw new Error("manifest 缺少 name/version");
  if (!pkg.files || typeof pkg.files !== "object") {
    throw new Error("包缺少 files");
  }
  for (const [path, data] of Object.entries(pkg.files)) {
    if (!isSafePackagePath(path)) throw new Error(`非法的文件路径：${path}`);
    if (typeof data !== "string") throw new Error(`文件内容非字符串：${path}`);
  }
  return pkg as PluginPackage;
}
