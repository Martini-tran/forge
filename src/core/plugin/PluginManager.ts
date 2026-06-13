import type { Plugin } from './types';

/**
 * Discovers, loads and tracks plugins from the `plugins/` directory.
 */
export class PluginManager {
  private plugins: Plugin[] = [];

  /**
   * Scan the plugins directory, read each `plugin.json` and load its entry
   * module.
   *
   * TODO: read the filesystem, validate manifests and require entry modules.
   */
  async loadPlugins(): Promise<void> {
    // TODO: implement plugin discovery and loading.
  }

  /** Currently loaded plugins. */
  getPlugins(): Plugin[] {
    return this.plugins;
  }
}
