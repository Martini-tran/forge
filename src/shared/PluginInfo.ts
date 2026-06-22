import type { PluginManifest } from './PluginManifest';
import type { PluginConfigValues } from './PluginConfig';

/** A discovered plugin (manifest + management state) for the plugins UI. */
export interface PluginInfo extends PluginManifest {
  /** Whether the plugin is enabled (defaults to true until toggled off). */
  enabled: boolean;
  /**
   * User-defined extra search keywords (space/comma separated), set in the
   * plugins settings — added on top of the manifest's `keywords` so the user
   * can search and open the plugin by their own terms. Empty if unset.
   */
  userKeywords: string;
  /** Precomputed pinyin of `name` (full + initials), or "" — see AppEntry.pinyin. */
  pinyin: string;
  /** Absolute plugin directory. */
  dir: string;
  /** How the plugin was installed. */
  source: 'package' | 'npm';
  /** npm package name when `source === "npm"`. */
  packageName?: string;
  /**
   * Whether the plugin can be uninstalled (removed from disk). Currently always
   * true — every plugin, including seeded built-ins, lives in the writable user
   * plugins directory.
   */
  removable: boolean;
  /**
   * For `view` plugins: open directly in the detached window when activated
   * from the launcher, instead of inline. User-set in the plugins settings;
   * defaults to false.
   */
  openInWindow: boolean;
  /**
   * Effective config values (manifest defaults overlaid with the user's stored
   * values), for the management UI to render and edit. Empty when the plugin
   * declares no `config` schema.
   */
  configValues: PluginConfigValues;
}
