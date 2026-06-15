import type { PluginManifest } from '../../shared/PluginManifest';
import type { PluginConfigValues } from '../../shared/PluginConfig';
import type { SearchResult } from '../../shared/SearchResult';
import type { RequestClient } from '../../shared/request-client';

/** Options for creating an additional plugin HTTP client at runtime. */
export interface PluginHttpClientOptions {
  /** Base URL for this client (overrides the manifest's `request.baseURL`). */
  baseURL?: string;
  /** Per-request timeout in ms. */
  timeout?: number;
  /** Headers merged into every request from this client. */
  headers?: Record<string, string>;
  /** Return shape: 'body' (default), 'raw' (full response) or 'data'. */
  responseReturn?: 'data' | 'body' | 'raw';
}

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
  /**
   * HTTP client bound to the plugin's manifest `request` defaults (baseURL etc.).
   * Requests run in the main process via Electron's net stack. Methods return
   * the parsed response body by default; pass `{ responseReturn: 'raw' }` for
   * the full response (status/headers).
   */
  http: RequestClient;
  /** Create an additional HTTP client with custom defaults (e.g. another baseURL). */
  createHttpClient(options?: PluginHttpClientOptions): RequestClient;
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
