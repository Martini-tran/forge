import { net } from 'electron';
import { RequestClient, type RequestConfig } from '../../shared/request-client';
import type { PluginManifest } from '../../shared/PluginManifest';

/**
 * Plugin HTTP capability. All plugin network requests — whether issued by a
 * plugin's main-side code (`init(ctx).http`) or by its sandboxed view UI (via
 * the `plugin:request` bridge) — go through here and run in the main process
 * using Electron's `net.fetch` (Chromium net stack, system-proxy aware). This
 * keeps a single, consistent request engine (see shared/request-client) and
 * lets view UIs reach the network despite the `plugin://` CSP, since the actual
 * fetch happens in main, not in the webview.
 */

/** HTTP defaults a plugin declares in its manifest's `request` block. */
export type PluginRequestDefaults = NonNullable<PluginManifest['request']>;

// `net.fetch` matches the web fetch signature closely enough; one cast bridges
// the slightly different RequestInit typing between Electron and lib.dom.
const netFetch = (input: string, init?: RequestInit): Promise<Response> =>
  net.fetch(input, init as any) as unknown as Promise<Response>;

/**
 * Build a RequestClient bound to a plugin's manifest defaults. Plugin code may
 * override `baseURL` / `timeout` / `headers` per client (and again per request).
 * Defaults to `responseReturn: 'body'` — plugins get the parsed response body,
 * since their backend shapes vary (no app-wide R unwrap is imposed).
 */
export function createPluginHttpClient(
  defaults: PluginRequestDefaults = {},
  overrides: {
    baseURL?: string;
    timeout?: number;
    headers?: Record<string, string>;
    responseReturn?: 'data' | 'body' | 'raw';
  } = {},
): RequestClient {
  return new RequestClient({
    fetch: netFetch,
    baseURL: overrides.baseURL ?? defaults.baseURL ?? '',
    timeout: overrides.timeout ?? defaults.timeout ?? 0,
    headers: { ...defaults.headers, ...overrides.headers },
    responseReturn: overrides.responseReturn ?? 'body',
  });
}

/**
 * Run a single request for a plugin's view UI. `defaults` come from the plugin's
 * manifest; `config` comes from the UI (its `baseURL`/`responseReturn`, if set,
 * win over the manifest defaults). Returns the parsed body by default.
 */
export function runPluginHttpRequest(
  defaults: PluginRequestDefaults,
  config: RequestConfig,
): Promise<unknown> {
  const client = createPluginHttpClient(defaults);
  return client.request(config);
}
