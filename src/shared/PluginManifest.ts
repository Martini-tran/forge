/**
 * Shape of a plugin's `plugin.json` manifest, shared between the plugin loader
 * (main/core) and the renderer.
 */
export interface PluginManifest {
  /** Unique plugin identifier. */
  id: string;
  /** Human-readable plugin name. */
  name: string;
  /** Semver version string. */
  version: string;
  /**
   * How the plugin surfaces in the launcher. `inline` (default) contributes
   * search results directly into the list; `view` appears as an entry that,
   * when selected, opens the plugin's own UI in a sandboxed webview.
   */
  type?: "inline" | "view";
  /**
   * Main-process entry module (e.g. `index.js`). Required for `inline` plugins;
   * optional for `view` plugins (only needed for privileged RPC logic).
   */
  entry?: string;
  /**
   * For `view` plugins: HTML entry for the plugin UI, relative to the plugin
   * directory (e.g. `ui/index.html`). Served over the `plugin://` protocol.
   */
  ui?: string;
  /**
   * Optional icon/logo, relative to the plugin directory (e.g. `icon.svg`).
   * `discoverPlugins` resolves it to a data URI for the renderer.
   */
  icon?: string;
  /** Optional short description. */
  description?: string;
  /** Optional keywords that trigger this plugin in search. */
  keywords?: string[];
  /**
   * For `view` plugins: defaults for the detached window (opened via "分离为
   * 独立窗口"). `width`/`height` set the initial size; `alwaysOnTop` starts the
   * window pinned above all applications. The user's runtime changes (the pin
   * toggle, plus moving/resizing) are remembered and take precedence next time.
   */
  window?: {
    width?: number;
    height?: number;
    alwaysOnTop?: boolean;
  };
  /**
   * Optional user-configurable settings. Each field is rendered as a control in
   * the plugins management UI; the user's values are persisted and exposed back
   * to the plugin (main-side via `init(ctx).getConfig()`, view UIs via
   * `window.pluginHost.getConfig()`). See PluginConfig.ts for value handling.
   */
  config?: PluginConfigField[];
}

/** Control type for a single config field. */
export type PluginConfigType = "string" | "number" | "boolean" | "select";

/** One user-configurable setting declared by a plugin's manifest. */
export interface PluginConfigField {
  /** Stable key used to read/write the value. */
  key: string;
  /** Type → input control + stored value type. */
  type: PluginConfigType;
  /** Label shown next to the control. */
  label: string;
  /** Optional helper text shown under the control. */
  description?: string;
  /** Default applied until the user sets a value. */
  default?: string | number | boolean;
  /** Choices for `select` fields (value is what gets stored). */
  options?: { label: string; value: string }[];
  /** Placeholder for `string`/`number` inputs. */
  placeholder?: string;
  /** Bounds/step for `number` fields. */
  min?: number;
  max?: number;
  step?: number;
}
