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
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { shell, clipboard } = require("electron");

const execFileAsync = promisify(execFile);

// Tunables, overridable via plugin config (see plugin.json "config" + init()).
let esPath = ""; // explicit es.exe path; empty → auto-detect
let everythingPath = ""; // explicit Everything.exe path; empty → auto-detect
let maxResults = 50; // cap result count (es.exe -n)
let sortBy = "name"; // es.exe -sort value
let matchPath = false; // match full path, not just the file name (-p)
let matchCase = false; // case-sensitive match (-i)
let regex = false; // treat the query as a regular expression (-r)

let tmpCounter = 0; // disambiguates concurrent export temp files

// Valid es.exe -sort values. A bad/blank config value (e.g. a select saved as
// "") must never reach es as `-sort ""`, which es rejects with a CLI error.
const SORTS = new Set([
  "name",
  "path",
  "size",
  "extension",
  "date-created",
  "date-modified",
  "date-accessed",
  "run-count",
  "date-run",
]);

/** Apply config values from the management UI (init + onConfigChange). */
function applyConfig(cfg) {
  if (typeof cfg.esPath === "string") esPath = cfg.esPath.trim();
  if (typeof cfg.everythingPath === "string")
    everythingPath = cfg.everythingPath.trim();
  if (typeof cfg.maxResults === "number" && cfg.maxResults > 0)
    maxResults = cfg.maxResults;
  // Only accept a whitelisted sort; anything else falls back to "name".
  sortBy = SORTS.has(cfg.sortBy) ? cfg.sortBy : "name";
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

/** Resolve the Everything.exe to auto-start: explicit config → bundled bin/. */
function resolveEverything() {
  const candidates = [];
  if (everythingPath) candidates.push(everythingPath);
  candidates.push(path.join(__dirname, "bin", "Everything.exe"));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null; // no bundled Everything → can't auto-start
}

/** True if a running Everything instance answers es.exe's IPC probe. */
async function isEverythingUp() {
  try {
    await execFileAsync(resolveEs(), ["-get-everything-version"], {
      windowsHide: true,
      timeout: 4000,
    });
    return true;
  } catch {
    return false;
  }
}

let startingPromise = null; // de-dupes concurrent auto-start attempts

/**
 * Make sure Everything is running so es.exe has something to query. If it isn't
 * and we have an Everything.exe to launch, start it silently in the background
 * (-startup: no window, tray-resident) and poll until its IPC window is up.
 * Returns true once Everything answers, false if we can't bring it up.
 */
async function ensureEverythingRunning() {
  if (await isEverythingUp()) return true;
  const ev = resolveEverything();
  if (!ev) return false;
  if (!startingPromise) {
    startingPromise = (async () => {
      try {
        const child = spawn(ev, ["-startup"], {
          windowsHide: true,
          detached: true,
          stdio: "ignore",
        });
        child.unref(); // let Everything outlive our process, like a normal launch
      } catch {
        return false;
      }
      // Everything needs a moment to create its IPC window (+ initial index).
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isEverythingUp()) return true;
      }
      return false;
    })().finally(() => {
      startingPromise = null;
    });
  }
  return startingPromise;
}

/**
 * Map a spawn/exit error from es.exe to a stable UI error code.
 * - ENOENT: the binary wasn't found.
 * - killed: our timeout fired.
 * - exit code 8 ("Everything IPC window not found"): Everything isn't running.
 *   (Exit code 4 is a command-line argument error, NOT a liveness signal.)
 */
function classifyEsError(err) {
  if (!err) return null;
  if (err.code === "ENOENT") return "no-es";
  if (err.killed) return "timeout";
  if (err.code === 8) return "not-running";
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
async function runEsExport(es, query, tmp) {
  const cliArgs = ["-n", String(maxResults), "-sort", sortBy];
  if (matchCase) cliArgs.push("-i");
  if (matchPath) cliArgs.push("-p");
  if (regex) cliArgs.push("-r");
  // Export only the full path+name column, UTF-8 with BOM; we derive the rest.
  cliArgs.push("-full-path-and-name", "-export-txt", tmp, "-utf8-bom", query);
  await execFileAsync(es, cliArgs, { windowsHide: true, timeout: 8000 });
}

async function search(args) {
  const query = (args && typeof args.query === "string" ? args.query : "").trim();
  if (!query) return { items: [] };

  const es = resolveEs();
  const tmp = path.join(
    os.tmpdir(),
    `orccode-es-${process.pid}-${++tmpCounter}.txt`,
  );

  try {
    await runEsExport(es, query, tmp);
  } catch (err) {
    const code = classifyEsError(err);
    if (code === "no-es" || code === "timeout") {
      fs.promises.unlink(tmp).catch(() => {});
      return { error: code };
    }
    if (code === "not-running") {
      // Try to bring Everything up ourselves, then retry the query once.
      const up = await ensureEverythingRunning();
      if (!up) {
        fs.promises.unlink(tmp).catch(() => {});
        return { error: "not-running" };
      }
      try {
        await runEsExport(es, query, tmp);
      } catch {
        fs.promises.unlink(tmp).catch(() => {});
        return { error: "not-running" };
      }
    }
    // other non-zero exits may still have produced a usable file → fall through
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
    // Warm up: if Everything isn't running yet, start it now so the first
    // search is ready. Fire-and-forget — never block plugin load.
    ensureEverythingRunning().catch(() => {});
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
     * If Everything isn't running but we can auto-start it, kick that off in the
     * background and report 'starting' so the UI shows a transient hint and
     * re-probes — the user never has to launch Everything by hand.
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
        const code = classifyEsError(err);
        if (code === "no-es") return { ok: false, error: "no-es", esPath: es };
        // Not running: auto-start if we have an Everything.exe, else guide.
        if (resolveEverything()) {
          ensureEverythingRunning(); // fire-and-forget; UI re-probes
          return { ok: false, error: "starting", esPath: es };
        }
        return { ok: false, error: "not-running", esPath: es };
      }
    },
  },
};
