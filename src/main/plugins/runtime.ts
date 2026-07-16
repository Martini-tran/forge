import { createRequire } from 'node:module';
import path from 'node:path';
import { discoverPlugins } from './discover';
import { createPluginHttpClient, type PluginRequestDefaults } from './http';
import { getPluginConfig } from '../../core/database';
import { resolvePluginConfig } from '../../shared/PluginConfig';
import type { Plugin, PluginContext } from '../../core/plugin/types';
import type { PluginConfigField } from '../../shared/PluginManifest';
import type { PluginConfigValues } from '../../shared/PluginConfig';
import type { SearchResult } from '../../shared/SearchResult';

/**
 * Plugin runtime: loads enabled plugins' entry modules and runs their hooks.
 * `inline` plugins expose search()/execute() (merged into the launcher list);
 * `view` plugins expose an `rpc` map their sandboxed UI calls over the bridge.
 * The main process is bundled as CommonJS, so entry files are loaded with a
 * runtime `require` (via createRequire, which Rollup leaves untouched — plugin
 * code is never bundled). Every hook is isolated in try/catch so a broken
 * plugin can't crash the launcher.
 */

// `createRequire(__filename)` (not import.meta.url — the main bundle is CJS)
// gives us a real Node require that resolves files from disk at runtime.
const nodeRequire = createRequire(__filename);

/**
 * Drop cached CommonJS modules whose file path lives under any of `roots` so the
 * next `loadPlugins()` re-executes their entry files. Node caches required
 * modules, so without this a developer-mode plugin's code changes would never
 * take effect on reload. Also clears the `initialized` marks for the given
 * plugin ids so their `init(ctx)` runs again against the fresh module.
 */
export function clearDevPluginModules(roots: string[], ids: string[]): void {
  if (roots.length === 0 && ids.length === 0) return;
  const normRoots = roots.map((r) => path.resolve(r) + path.sep);
  for (const key of Object.keys(nodeRequire.cache)) {
    const resolved = path.resolve(key);
    if (normRoots.some((r) => resolved.startsWith(r))) {
      delete nodeRequire.cache[key];
    }
  }
  for (const id of ids) initialized.delete(id);
}

let loaded: Plugin[] = [];
// id → absolute dir for every ENABLED plugin (incl. pure-UI view plugins with
// no entry module). The `plugin://` protocol uses this to serve assets.
const enabledDirs = new Map<string, string>();

// id → its manifest's config schema, refreshed each discover so getConfig()
// always resolves against the current declared fields.
const pluginSchemas = new Map<string, PluginConfigField[]>();
// id → its manifest's `request` HTTP defaults (baseURL/timeout/headers),
// refreshed each discover. Used by ctx.http and the plugin:request bridge.
const pluginRequestDefaults = new Map<string, PluginRequestDefaults>();
// id → main-side config-change subscribers registered via init(ctx).
const configSubscribers = new Map<
  string,
  Set<(config: PluginConfigValues) => void>
>();
// Plugins whose init(ctx) has already run. Node caches required modules, so a
// reload won't re-execute init — track this to call it exactly once per plugin.
const initialized = new Set<string>();

/** A plugin's effective config (manifest defaults + user overrides). */
export function getEffectivePluginConfig(id: string): PluginConfigValues {
  return resolvePluginConfig(pluginSchemas.get(id), getPluginConfig(id));
}

/** A plugin's declared HTTP defaults (manifest `request` block, or {}). */
export function getPluginRequestDefaults(id: string): PluginRequestDefaults {
  return pluginRequestDefaults.get(id) ?? {};
}

/** Build the host context handed to a plugin's init(ctx). */
function makeContext(id: string): PluginContext {
  return {
    getConfig: () => getEffectivePluginConfig(id),
    onConfigChange: (cb) => {
      let set = configSubscribers.get(id);
      if (!set) {
        set = new Set();
        configSubscribers.set(id, set);
      }
      set.add(cb);
      return () => set.delete(cb);
    },
    http: createPluginHttpClient(getPluginRequestDefaults(id)),
    createHttpClient: (options) =>
      createPluginHttpClient(getPluginRequestDefaults(id), options),
  };
}

/** Notify a plugin's main-side init(ctx) subscribers that its config changed. */
export function notifyPluginConfigChanged(id: string): void {
  const config = getEffectivePluginConfig(id);
  for (const cb of configSubscribers.get(id) ?? []) {
    try {
      cb(config);
    } catch (err) {
      console.error(`[plugins] ${id} config handler failed:`, err);
    }
  }
}

/** Discover enabled plugins and (re)build the in-memory loaded set. */
export async function loadPlugins(): Promise<void> {
  const infos = await discoverPlugins();
  const next: Plugin[] = [];
  enabledDirs.clear();
  pluginSchemas.clear();
  pluginRequestDefaults.clear();

  for (const info of infos) {
    // Track every plugin's schema (incl. disabled ones) so its config can be
    // resolved and edited in the management UI regardless of enabled state.
    pluginSchemas.set(info.id, info.config ?? []);
    pluginRequestDefaults.set(info.id, info.request ?? {});
    if (!info.enabled) continue;
    enabledDirs.set(info.id, info.dir);
    if (!info.entry) continue; // pure-UI view plugin: nothing to require

    const entryPath = path.join(info.dir, info.entry);
    try {
      const mod = nodeRequire(entryPath) as Partial<Plugin> & {
        init?: (ctx: PluginContext) => void;
      };
      const plugin: Plugin = { manifest: info };

      if (info.type === 'view') {
        if (mod.rpc && typeof mod.rpc === 'object') plugin.rpc = mod.rpc;
      } else {
        if (typeof mod.search !== 'function') {
          console.error(`[plugins] ${info.id}: entry has no search() export`);
          continue;
        }
        plugin.search = mod.search.bind(mod);
        if (typeof mod.execute === 'function')
          plugin.execute = mod.execute.bind(mod);
      }

      // Hand the plugin its config context exactly once (modules are cached, so
      // a reload returns the same instance and must not re-init).
      if (typeof mod.init === 'function' && !initialized.has(info.id)) {
        initialized.add(info.id);
        try {
          mod.init(makeContext(info.id));
        } catch (err) {
          console.error(`[plugins] ${info.id} init failed:`, err);
        }
      }

      next.push(plugin);
    } catch (err) {
      console.error(`[plugins] failed to load ${info.id}:`, err);
    }
  }

  loaded = next;
}

/** Rebuild the loaded set (e.g. after a plugin is enabled/disabled). */
export async function reloadPlugins(): Promise<void> {
  await loadPlugins();
}

/** Absolute dir for an enabled plugin, or undefined. Used by the protocol. */
export function enabledPluginDir(id: string): string | undefined {
  return enabledDirs.get(id);
}

/** Run every inline plugin's search and return their results (pluginId-stamped). */
export async function searchPlugins(query: string): Promise<SearchResult[]> {
  const out: SearchResult[] = [];
  for (const plugin of loaded) {
    if (typeof plugin.search !== 'function') continue; // view plugins
    try {
      const results = await plugin.search(query);
      if (!Array.isArray(results)) continue;
      for (const r of results) out.push({ ...r, pluginId: plugin.manifest.id });
    } catch (err) {
      console.error(`[plugins] ${plugin.manifest.id} search failed:`, err);
    }
  }
  return out;
}

/** Activate a result produced by the given inline plugin. */
export async function executePlugin(
  pluginId: string,
  action: string,
): Promise<void> {
  const plugin = loaded.find((p) => p.manifest.id === pluginId);
  if (typeof plugin?.execute !== 'function') return;
  try {
    await plugin.execute(action);
  } catch (err) {
    console.error(`[plugins] ${pluginId} execute failed:`, err);
  }
}

/**
 * Call a view plugin's RPC method from its UI. Security: only own, function
 * properties of the module's explicit `rpc` map are callable — no prototype
 * chain, inherited, or non-function access. `pluginId` is resolved by the
 * caller from the webview's committed origin (never asserted by plugin JS).
 */
export async function invokePlugin(
  pluginId: string,
  method: string,
  args: unknown,
): Promise<unknown> {
  const plugin = loaded.find((p) => p.manifest.id === pluginId);
  const rpc = plugin?.rpc;
  if (!rpc) throw new Error(`plugin not invocable: ${pluginId}`);
  if (!Object.prototype.hasOwnProperty.call(rpc, method)) {
    throw new Error(`no such method: ${method}`);
  }
  const fn = rpc[method];
  if (typeof fn !== 'function') throw new Error(`not callable: ${method}`);
  try {
    return await fn(args);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
}
