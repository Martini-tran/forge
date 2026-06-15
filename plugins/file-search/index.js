// File-search plugin (view type). Wraps voidtools' Everything via its
// command-line client `es.exe`: each query spawns es.exe, which talks over IPC
// to the running Everything instance and returns whole-disk filename matches in
// milliseconds. The sandboxed UI (plugins/file-search/ui) calls the allow-listed
// `rpc` map below over the pluginHost bridge — it never touches the filesystem
// or spawns processes itself.
//
// Requirements (surfaced to the user via rpc.status() + the UI empty state):
//   1. Everything is installed AND running (it provides the index/IPC service).
//   2. es.exe is locatable: config `esPath` → <pluginDir>/bin/es.exe → PATH.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { shell, clipboard } = require("electron");

const execFileAsync = promisify(execFile);

// Tunables, overridable via plugin config (see plugin.json "config" + init()).
let esPath = ""; // explicit es.exe path; empty → auto-detect
let maxResults = 50; // cap result count (es.exe -n)
let sortBy = "name"; // es.exe -sort value
let matchPath = false; // match full path, not just the file name (-p)
let matchCase = false; // case-sensitive match (-i)
let regex = false; // treat the query as a regular expression (-r)

let tmpCounter = 0; // disambiguates concurrent export temp files

/** Apply config values from the management UI (init + onConfigChange). */
function applyConfig(cfg) {
  if (typeof cfg.esPath === "string") esPath = cfg.esPath.trim();
  if (typeof cfg.maxResults === "number") maxResults = cfg.maxResults;
  if (typeof cfg.sortBy === "string" && cfg.sortBy) sortBy = cfg.sortBy;
  matchPath = !!cfg.matchPath;
  matchCase = !!cfg.matchCase;
  regex = !!cfg.regex;
}

/** Resolve the es.exe to invoke: explicit config → bundled bin/ → PATH. */
function resolveEs() {
  if (esPath) return esPath;
  const bundled = path.join(__dirname, "bin", "es.exe");
  try {
    if (fs.existsSync(bundled)) return bundled;
  } catch {
    /* ignore */
  }
  return "es"; // fall back to PATH
}

/**
 * Map a spawn/exit error from es.exe to a stable UI error code.
 * - ENOENT: the binary wasn't found.
 * - exit code 4 (ES_ERROR_IPC): Everything isn't running.
 * - killed: our timeout fired.
 */
function classifyEsError(err) {
  if (!err) return null;
  if (err.code === "ENOENT") return "no-es";
  if (err.killed) return "timeout";
  if (err.code === 4) return "not-running";
  return "error";
}

/** Human-readable file size. */
function formatSize(bytes) {
  if (!bytes || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${u === 0 ? n : n.toFixed(1)} ${units[u]}`;
}

/**
 * Query Everything via es.exe. Results are exported to a UTF-8 (BOM) temp file
 * rather than read from stdout — es.exe's stdout uses the OEM code page, which
 * mangles non-ASCII (e.g. Chinese) names; the BOM'd file is reliably UTF-8.
 */
async function search(args) {
  const query = (args && typeof args.query === "string" ? args.query : "").trim();
  if (!query) return { items: [] };

  const es = resolveEs();
  const tmp = path.join(
    os.tmpdir(),
    `orccode-es-${process.pid}-${++tmpCounter}.txt`,
  );
  const cliArgs = ["-n", String(maxResults), "-sort", sortBy];
  if (matchCase) cliArgs.push("-i");
  if (matchPath) cliArgs.push("-p");
  if (regex) cliArgs.push("-r");
  // Export only the full path+name column, UTF-8 with BOM; we derive the rest.
  cliArgs.push("-full-path-and-name", "-export-txt", tmp, "-utf8-bom", query);

  try {
    await execFileAsync(es, cliArgs, { windowsHide: true, timeout: 8000 });
  } catch (err) {
    const code = classifyEsError(err);
    // exit-code 4 / ENOENT / timeout are terminal; other non-zero exits may
    // still have produced a usable file, so only bail on the terminal ones.
    if (code === "no-es" || code === "not-running" || code === "timeout") {
      fs.promises.unlink(tmp).catch(() => {});
      return { error: code };
    }
  }

  let raw;
  try {
    raw = fs.readFileSync(tmp, "utf8");
  } catch {
    return { error: "not-running" }; // no file → es never reached Everything
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }

  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
  // -export-txt emits one full path per line and no header, but guard anyway:
  // keep only lines that look like a Windows/UNC path (drive, backslash or slash).
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && /[\\/]/.test(l));

  const items = await Promise.all(
    lines.slice(0, maxResults).map(async (full, idx) => {
      let isDir = false;
      let size = 0;
      let mtime = 0;
      try {
        const st = await fs.promises.stat(full);
        isDir = st.isDirectory();
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        /* file may have been moved/deleted since indexing */
      }
      return {
        id: `r${idx}`,
        name: path.basename(full) || full,
        path: full,
        dir: path.dirname(full),
        isDir,
        size: isDir ? "" : formatSize(size),
        mtime,
      };
    }),
  );

  return { items };
}

/** Pull a non-empty string path out of an rpc arg object. */
function pickPath(args) {
  const p = args && typeof args.path === "string" ? args.path : "";
  return p.trim() ? p : null;
}

module.exports = {
  /** Read config before first use; re-apply live when the user changes it. */
  init(ctx) {
    applyConfig(ctx.getConfig());
    ctx.onConfigChange(applyConfig);
  },

  // Methods callable from the plugin UI via window.pluginHost.invoke(...).
  rpc: {
    search,

    /** Open a file/folder with its default handler. */
    open(args) {
      const p = pickPath(args);
      if (!p) return false;
      shell.openPath(p);
      return true;
    },

    /** Reveal a path in Explorer (selects the item). */
    reveal(args) {
      const p = pickPath(args);
      if (!p) return false;
      shell.showItemInFolder(p);
      return true;
    },

    /** Copy a path to the clipboard. */
    copyPath(args) {
      const p = pickPath(args);
      if (!p) return false;
      clipboard.writeText(p);
      return true;
    },

    /**
     * Probe es.exe + Everything availability for the UI's first-run guidance.
     * `-get-everything-version` needs the running Everything instance, so it
     * doubles as a liveness check.
     */
    async status() {
      const es = resolveEs();
      try {
        await execFileAsync(es, ["-get-everything-version"], {
          windowsHide: true,
          timeout: 5000,
        });
        return { ok: true, esPath: es };
      } catch (err) {
        return { ok: false, error: classifyEsError(err) || "error", esPath: es };
      }
    },
  },
};
