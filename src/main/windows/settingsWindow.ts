import { BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import { getTheme } from '../settings';
import { appIconPath } from '../icon';

/**
 * The settings window — a normal framed, resizable window (unlike the frameless
 * launcher). It loads the SAME renderer bundle via the `#/settings` hash route,
 * so no extra Vite entry is needed.
 */

let settingsWindow: BrowserWindow | null = null;

export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  const theme = getTheme();
  const dark =
    theme === 'dark' ||
    (theme === 'system' && nativeTheme.shouldUseDarkColors);

  settingsWindow = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'ORC',
    icon: appIconPath(),
    backgroundColor: dark ? '#1c1c1c' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  settingsWindow.setMenuBarVisibility(false);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/settings`);
  } else {
    settingsWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: '/settings' },
    );
  }

  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}
