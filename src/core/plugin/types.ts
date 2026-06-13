import type { PluginManifest } from '../../shared/PluginManifest';
import type { PluginConfigValues } from '../../shared/PluginConfig';
import type { SearchResult } from '../../shared/SearchResult';

/** Explicit, allow-listed RPC handlers a `view` plugin exposes to its UI. */
export type PluginRpc = Record<
  string,
  (args: unknown) => unknown | Promise<unknown>
>;

/**
 * Host services handed to a plugin's optional `init(ctx)` export when it is
 * first loaded. Lets main-side plugin code read its user config and react to
 * changes (the same values its view UI sees via window.pluginHost.getConfig()).
 */
export interface PluginContext {
  /** The plugin's current effective config (defaults + user overrides). */
  getConfig(): PluginConfigValues;
  /** Subscribe to config changes; returns an unsubscribe function. */
  onConfigChange(cb: (config: PluginConfigValues) => void): () => void;
}

/**
 * Runtime contract a loaded plugin module may satisfy. `inline` plugins provide
 * `search` (+ optional `execute`); `view` plugins provide an `rpc` map their UI
 * calls over the bridge. Both are optional so a plugin can be either kind.
 */
export interface Plugin {
  /** Parsed manifest from the plugin's `plugin.json`. */
  manifest: PluginManifest;
  /** Return results for a given user query (inline plugins). */
  search?(query: string): SearchResult[] | Promise<SearchResult[]>;
  /** Handle activation of one of this plugin's results (inline plugins). */
  execute?(action: string): void | Promise<void>;
  /** Allow-listed methods callable from the plugin UI (view plugins). */
  rpc?: PluginRpc;
}
