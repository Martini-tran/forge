import path from "node:path";
import { app } from "electron";

/**
 * Filesystem roots for plugins.
 *
 * Plugins RUN from a user-writable directory (`userPluginsRoot`) so they can be
 * installed and uninstalled at runtime. The app ships pre-packed `.orcpkg`
 * bundles (`bundledPluginsRoot`) that are seeded into the user dir on first run
 * — see install.ts seedBundledPlugins.
 */

/** Where installed plugins live and are loaded from (writable). */
export function userPluginsRoot(): string {
  return path.join(app.getPath("userData"), "plugins");
}

/** Where the app's shipped `.orcpkg` seed packages live (read-only). */
export function bundledPluginsRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "bundled-plugins")
    : path.join(app.getAppPath(), "bundled-plugins");
}

/**
 * Source `plugins/` directory (dev only). Used as a fallback seed when no
 * pre-packed bundles exist yet (fresh checkout before `npm run pack:bundled`)
 * so the app still works out of the box during development.
 */
export function sourcePluginsRoot(): string {
  return path.join(app.getAppPath(), "plugins");
}
