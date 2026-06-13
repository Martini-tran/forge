// Clipboard-history plugin (view type). The main-side module keeps recording
// the clipboard and exposes an allow-listed `rpc` map that its sandboxed UI
// (plugins/clipboard/ui) calls over the pluginHost bridge. No search()/execute()
// — this plugin is opened as an entry, not inlined.
//
// Electron exposes no clipboard-change event, so we poll clipboard.readText()
// on an interval and keep a de-duplicated, capped, persisted history. The
// interval starts the first time this module is required (at app startup).

const fs = require("node:fs");
const path = require("node:path");
const { app, clipboard } = require("electron");

// Tunables, overridable via plugin config (see plugin.json "config" + init()).
let maxItems = 100; // cap history length
let maxTextLen = 10000; // skip very large clipboard payloads
let pollMs = 1000; // clipboard poll cadence

const FILE = path.join(app.getPath("userData"), "clipboard-history.json");

/** @type {{ id: string, text: string, ts: number }[]} */
let history = [];
let idCounter = 0;
let lastSeen = ""; // last clipboard value we recorded, to detect changes
let started = false;

function load() {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) history = parsed.filter((e) => e && e.text);
  } catch {
    history = []; // missing or corrupt → start fresh
  }
  lastSeen = history[0]?.text ?? "";
  idCounter = history.length;
}

let writePending = false;
function persist() {
  if (writePending) return;
  writePending = true;
  setImmediate(() => {
    writePending = false;
    fs.writeFile(FILE, JSON.stringify(history), "utf8", () => {});
  });
}

/** Record a clipboard value: dedupe (move to top), cap, persist. */
function record(text) {
  if (!text || text.length > maxTextLen) return;
  if (text === lastSeen) return;
  lastSeen = text;
  history = history.filter((e) => e.text !== text);
  history.unshift({ id: `c${++idCounter}`, text, ts: Date.now() });
  if (history.length > maxItems) history.length = maxItems;
  persist();
}

let timer = null;

/** (Re)start the poll loop at the current `pollMs` cadence. */
function startPolling() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    try {
      record(clipboard.readText());
    } catch {
      /* ignore transient clipboard read failures */
    }
  }, pollMs);
  timer.unref?.();
}

function start() {
  if (started) return; // guard against double-start on reload
  started = true;
  load();
  startPolling();
}

/** One-line preview for a history row. */
function preview(text) {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

function timeAgo(ts) {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.round(hr / 24)} 天前`;
}

/** Apply config values; restart the poll loop if the cadence changed. */
function applyConfig(cfg) {
  if (typeof cfg.maxItems === "number") {
    maxItems = cfg.maxItems;
    if (history.length > maxItems) {
      history.length = maxItems;
      persist();
    }
  }
  if (typeof cfg.maxTextLen === "number") maxTextLen = cfg.maxTextLen;
  if (typeof cfg.pollMs === "number" && cfg.pollMs !== pollMs) {
    pollMs = cfg.pollMs;
    if (started) startPolling(); // re-arm at the new cadence
  }
}

module.exports = {
  /**
   * Called once by the host with this plugin's config context. We read the
   * user's settings before starting the poll loop, and re-apply them live when
   * they change in 插件管理.
   */
  init(ctx) {
    applyConfig(ctx.getConfig());
    start();
    ctx.onConfigChange(applyConfig);
  },

  // Methods callable from the plugin UI via window.pluginHost.invoke(...).
  rpc: {
    /** Return history rows, optionally filtered by a substring query. */
    list(args) {
      const f = (args?.query ?? "").trim().toLowerCase();
      const items = f
        ? history.filter((e) => e.text.toLowerCase().includes(f))
        : history;
      return items.slice(0, 50).map((e) => ({
        id: e.id,
        preview: preview(e.text),
        subtitle: `${timeAgo(e.ts)} · ${e.text.length} 字符`,
      }));
    },

    /** Re-copy a history entry to the clipboard. Returns whether it was found. */
    copy(args) {
      const entry = history.find((e) => e.id === args?.id);
      if (!entry) return false;
      clipboard.writeText(entry.text);
      lastSeen = entry.text; // don't re-record our own write
      return true;
    },
  },
};
