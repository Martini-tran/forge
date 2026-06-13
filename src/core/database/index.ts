import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { app } from "electron";
import type { AppEntry, CustomApp } from "../../shared/AppEntry";
import type { PluginConfigValues } from "../../shared/PluginConfig";

/**
 * Local SQLite store backed by Node's built-in `node:sqlite` (ships with the
 * Electron runtime — no native compilation, unlike better-sqlite3). Used to
 * cache the scanned application list so we don't rescan on every launch.
 */

let db: DatabaseSync | null = null;

export function initDatabase(): void {
  if (db) return;
  db = new DatabaseSync(path.join(app.getPath("userData"), "orccode.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      path       TEXT NOT NULL,
      icon       TEXT,
      scanned_at INTEGER NOT NULL
    );
  `);
  // Usage lives in its own table so it survives the DELETE+INSERT rescan of
  // `apps` (app ids are stable shortcut paths, so the join keeps working).
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage (
      app_id    TEXT PRIMARY KEY,
      used_at   INTEGER NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Key-value app settings (theme, hotkey, plugin enabled flags, …).
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // User-defined "quick open" entries (apps the scanner didn't find).
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_apps (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      target     TEXT NOT NULL,
      kind       TEXT NOT NULL,
      icon       TEXT,
      keywords   TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  // Extra search keywords for scanned apps. Keyed by app id and kept in its own
  // table so it survives the rescan of `apps` (same rationale as `usage`).
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_aliases (
      app_id   TEXT PRIMARY KEY,
      keywords TEXT NOT NULL
    );
  `);
  // Scanned apps the user removed from search. Kept in its own table so the
  // exclusion survives the rescan that would otherwise re-add the app.
  db.exec(`
    CREATE TABLE IF NOT EXISTS hidden_apps (
      app_id TEXT PRIMARY KEY
    );
  `);
}

function getDb(): DatabaseSync {
  if (!db) initDatabase();
  return db as DatabaseSync;
}

/** Cached (scanned) apps with alias keywords, EXCLUDING ones hidden from search. */
export function getCachedApps(): AppEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.name, a.path, a.icon, al.keywords
         FROM apps a
         LEFT JOIN app_aliases al ON al.app_id = a.id
         LEFT JOIN hidden_apps h ON h.app_id = a.id
        WHERE h.app_id IS NULL
        ORDER BY a.name COLLATE NOCASE`,
    )
    .all() as Array<{
    id: string;
    name: string;
    path: string;
    icon: string | null;
    keywords: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    path: r.path,
    icon: r.icon ?? "",
    source: "scanned" as const,
    keywords: r.keywords ?? undefined,
  }));
}

/** All scanned apps for the management UI, including hidden ones (with a flag). */
export function getScannedApps(): AppEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.name, a.path, a.icon, al.keywords,
              CASE WHEN h.app_id IS NULL THEN 0 ELSE 1 END AS hidden
         FROM apps a
         LEFT JOIN app_aliases al ON al.app_id = a.id
         LEFT JOIN hidden_apps h ON h.app_id = a.id
        ORDER BY a.name COLLATE NOCASE`,
    )
    .all() as Array<{
    id: string;
    name: string;
    path: string;
    icon: string | null;
    keywords: string | null;
    hidden: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    path: r.path,
    icon: r.icon ?? "",
    source: "scanned" as const,
    keywords: r.keywords ?? undefined,
    hidden: r.hidden === 1,
  }));
}

/** Hide/unhide a scanned app from search results. */
export function setAppHidden(id: string, hidden: boolean): void {
  const d = getDb();
  if (hidden) {
    d.prepare("INSERT OR IGNORE INTO hidden_apps (app_id) VALUES (?)").run(id);
  } else {
    d.prepare("DELETE FROM hidden_apps WHERE app_id = ?").run(id);
  }
}

/** Record that an app was launched (bumps its recency and use count). */
export function recordUsage(id: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO usage (app_id, used_at, use_count) VALUES (?, ?, 1)
       ON CONFLICT(app_id) DO UPDATE SET used_at = ?, use_count = use_count + 1`,
    )
    .run(id, now, now);
}

/**
 * Raw recent-usage rows (id + timestamp), newest first, across every kind of
 * entry (scanned app, custom entry, or plugin). The caller resolves each id to
 * its display entry, so plugins — which live outside the `apps` table — can be
 * ranked by real recency alongside apps.
 */
export function getRecentUsage(
  limit = 50,
): Array<{ id: string; usedAt: number }> {
  const rows = getDb()
    .prepare(
      `SELECT app_id AS id, used_at FROM usage ORDER BY used_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ id: string; used_at: number }>;
  return rows.map((r) => ({ id: r.id, usedAt: r.used_at }));
}

/** Replace the cached app list in a single transaction. */
export function saveApps(apps: AppEntry[]): void {
  const d = getDb();
  const now = Date.now();
  const insert = d.prepare(
    "INSERT OR REPLACE INTO apps (id, name, path, icon, scanned_at) VALUES (?, ?, ?, ?, ?)",
  );
  d.exec("BEGIN");
  try {
    d.exec("DELETE FROM apps");
    for (const a of apps) {
      insert.run(a.id, a.name, a.path, a.icon, now);
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

/* ------------------------------------------------------------------ settings */

/** Read a single setting, or undefined if unset. */
export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string | null } | undefined;
  return row?.value ?? undefined;
}

/** All settings as a plain object. */
export function getAllSettings(): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings")
    .all() as Array<{
    key: string;
    value: string | null;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) if (r.value != null) out[r.key] = r.value;
  return out;
}

/** Upsert a setting. */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
    )
    .run(key, value, value);
}

/* -------------------------------------------------------------- custom apps */

export function getCustomApps(): CustomApp[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, target, kind, icon, keywords, created_at
         FROM custom_apps ORDER BY name COLLATE NOCASE`,
    )
    .all() as Array<{
    id: string;
    name: string;
    target: string;
    kind: string;
    icon: string | null;
    keywords: string | null;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    target: r.target,
    kind: r.kind === "url" ? "url" : "path",
    icon: r.icon ?? "",
    keywords: r.keywords ?? "",
    createdAt: r.created_at,
  }));
}

export function addCustomApp(app: CustomApp): void {
  getDb()
    .prepare(
      `INSERT INTO custom_apps (id, name, target, kind, icon, keywords, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      app.id,
      app.name,
      app.target,
      app.kind,
      app.icon,
      app.keywords,
      app.createdAt,
    );
}

export function updateCustomApp(app: CustomApp): void {
  getDb()
    .prepare(
      `UPDATE custom_apps
          SET name = ?, target = ?, kind = ?, icon = ?, keywords = ?
        WHERE id = ?`,
    )
    .run(app.name, app.target, app.kind, app.icon, app.keywords, app.id);
}

export function deleteCustomApp(id: string): void {
  getDb().prepare("DELETE FROM custom_apps WHERE id = ?").run(id);
}

/* ----------------------------------------------------------------- aliases */

/** Set (or clear, when empty) the alias keywords for a scanned app. */
export function setAlias(appId: string, keywords: string): void {
  const d = getDb();
  if (keywords.trim() === "") {
    d.prepare("DELETE FROM app_aliases WHERE app_id = ?").run(appId);
    return;
  }
  d.prepare(
    `INSERT INTO app_aliases (app_id, keywords) VALUES (?, ?)
     ON CONFLICT(app_id) DO UPDATE SET keywords = ?`,
  ).run(appId, keywords, keywords);
}

/* ----------------------------------------------------------- plugin states */

/** Map of plugin id → enabled flag (only ids that have been explicitly set). */
export function getPluginStates(): Record<string, boolean> {
  const rows = getDb()
    .prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'plugin:%:enabled'",
    )
    .all() as Array<{ key: string; value: string | null }>;
  const out: Record<string, boolean> = {};
  for (const r of rows) {
    const id = r.key.slice("plugin:".length, -":enabled".length);
    out[id] = r.value === "1";
  }
  return out;
}

export function setPluginState(id: string, enabled: boolean): void {
  setSetting(`plugin:${id}:enabled`, enabled ? "1" : "0");
}

/** Map of plugin id → user-defined extra search keywords (only ids that have any). */
export function getPluginKeywords(): Record<string, string> {
  const rows = getDb()
    .prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'plugin:%:keywords'",
    )
    .all() as Array<{ key: string; value: string | null }>;
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (!r.value) continue;
    const id = r.key.slice("plugin:".length, -":keywords".length);
    out[id] = r.value;
  }
  return out;
}

/** Set (or clear, when empty) a plugin's user-defined search keywords. */
export function setPluginKeywords(id: string, keywords: string): void {
  const kw = keywords.trim();
  if (kw === "") {
    getDb()
      .prepare("DELETE FROM settings WHERE key = ?")
      .run(`plugin:${id}:keywords`);
    return;
  }
  setSetting(`plugin:${id}:keywords`, kw);
}

/** Map of plugin id → "open in detached window by default" flag (only set ids). */
export function getPluginOpenInWindow(): Record<string, boolean> {
  const rows = getDb()
    .prepare(
      "SELECT key, value FROM settings WHERE key LIKE 'plugin:%:openInWindow'",
    )
    .all() as Array<{ key: string; value: string | null }>;
  const out: Record<string, boolean> = {};
  for (const r of rows) {
    const id = r.key.slice("plugin:".length, -":openInWindow".length);
    out[id] = r.value === "1";
  }
  return out;
}

/** Set whether a view plugin opens in its detached window by default. */
export function setPluginOpenInWindow(id: string, on: boolean): void {
  setSetting(`plugin:${id}:openInWindow`, on ? "1" : "0");
}

/** A plugin's stored config overrides (raw user values), or {} if unset. */
export function getPluginConfig(id: string): PluginConfigValues {
  const raw = getSetting(`plugin:${id}:config`);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PluginConfigValues)
      : {};
  } catch {
    return {}; // corrupt JSON → treat as unset
  }
}

/** Persist a plugin's config overrides as a JSON blob. */
export function setPluginConfig(id: string, values: PluginConfigValues): void {
  setSetting(`plugin:${id}:config`, JSON.stringify(values));
}
