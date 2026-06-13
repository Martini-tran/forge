import { app, Tray, Menu, nativeImage } from 'electron';
import { showMainWindow, toggleMainWindow } from './windows/mainWindow';
import { openSettingsWindow } from './windows/settingsWindow';
import { getOpenAtLogin, setOpenAtLogin } from './settings';
import { appIconPath } from './icon';

/**
 * The system tray icon. The launcher lives in the background (it hides instead
 * of quitting), so without a tray there is no visible entry point and no way to
 * quit short of killing the process. The tray gives the app a persistent home:
 * a left-click toggles the launcher, and the context menu exposes settings,
 * launch-at-login, and a real Quit.
 */

let tray: Tray | null = null;

/** Create the tray icon + menu. Idempotent (a no-op if one already exists). */
export function createTray(): void {
  if (tray) return;

  // .ico renders correctly in the Windows notification area; appIconPath()
  // already resolves the dev vs. packaged location.
  tray = new Tray(nativeImage.createFromPath(appIconPath()));
  tray.setToolTip('orccode');
  rebuildMenu();

  // Windows convention: left-clicking the tray icon summons/hides the app.
  tray.on('click', () => toggleMainWindow());
}

/** Rebuild the context menu, re-reading the OS launch-at-login state. */
function rebuildMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示启动器', click: () => showMainWindow() },
    { label: '设置', click: () => openSettingsWindow() },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      // OS is the source of truth; read it fresh each rebuild so the check
      // stays correct even when toggled from the settings window.
      checked: getOpenAtLogin(),
      click: (item) => {
        setOpenAtLogin(item.checked);
        rebuildMenu();
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

/** Re-sync the menu (e.g. after launch-at-login changes from the settings UI). */
export function refreshTrayMenu(): void {
  rebuildMenu();
}

/** Remove the tray icon (call on quit so it disappears immediately). */
export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
