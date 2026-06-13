import { app } from 'electron';
import path from 'node:path';

/**
 * Resolve the app icon (.ico). In dev it lives in the project's `assets/`
 * directory; when packaged, `assets/` is copied via forge's `extraResource`
 * into the resources folder.
 */
export const appIconPath = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'icon.ico')
    : path.join(app.getAppPath(), 'assets', 'icon.ico');
