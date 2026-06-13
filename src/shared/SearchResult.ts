/**
 * A single result rendered in the launcher's result list. Produced by plugins
 * and the search engine, consumed by the renderer.
 */
export interface SearchResult {
  /** Primary text shown for the result. */
  title: string;
  /** Optional secondary text shown beneath the title. */
  subtitle?: string;
  /** Optional icon (path or data URI). */
  icon?: string;
  /** Id of the plugin that produced this result. */
  pluginId?: string;
  /** Identifier passed back to the plugin when the result is activated. */
  action?: string;
}
