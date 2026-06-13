import { BrowserWindow, session, webContents } from 'electron';
import path from 'node:path';
import { appIconPath } from '../icon';
import { registerPluginProtocolOn } from '../plugins/protocol';

/**
 * The Vite forge plugin injects `MAIN_WINDOW_VITE_DEV_SERVER_URL` and
 * `MAIN_WINDOW_VITE_NAME` as globals at build time.
 */

let mainWindow: BrowserWindow | null = null;

// True while a view plugin's webview is open — suppresses blur-to-hide and
// switches the window to a fixed size (webview content can't drive height).
let launcherInPluginMode = false;

// guest webContents id → pluginId, derived from the webview's committed
// plugin:// origin (never asserted by plugin JS). Used to resolve plugin:invoke.
const webviewPlugin = new Map<number, string>();

// guest webContents id → the BrowserWindow hosting that plugin webview. Lets
// plugin:close/back act on the right window (launcher vs. a detached window).
const webviewHost = new Map<number, BrowserWindow>();

/** Resolve the pluginId bound to a webview's webContents, or undefined. */
export function pluginIdForWebContents(id: number): string | undefined {
  return webviewPlugin.get(id);
}

/** Resolve the window hosting a plugin webview's webContents, or undefined. */
export function hostWindowForWebContents(id: number): BrowserWindow | undefined {
  return webviewHost.get(id);
}

/** Send an IPC message to the launcher renderer (host of plugin webviews). */
export function notifyLauncher(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args);
}

/** Send an IPC message to every open <webview> guest bound to a plugin id. */
export function notifyPluginWebviews(
  pluginId: string,
  channel: string,
  ...args: unknown[]
): void {
  for (const [guestId, id] of webviewPlugin) {
    if (id !== pluginId) continue;
    webContents.fromId(guestId)?.send(channel, ...args);
  }
}

/** Enter/leave plugin mode: fixed larger size + suppressed auto-hide. */
export function setLauncherPluginMode(on: boolean): void {
  launcherInPluginMode = on;
  if (!mainWindow) return;
  if (on) {
    mainWindow.setResizable(true);
    mainWindow.setSize(672, 520, false);
    mainWindow.setResizable(false);
  }
  // Leaving plugin mode: the renderer's ResizeObserver re-reports the content
  // height via window:resize, so no explicit resize is needed here.
}

/**
 * Create the frameless, transparent launcher window (Raycast/Spotlight style).
 */
export const createMainWindow = (): BrowserWindow => {
  mainWindow = new BrowserWindow({
    width: 672,
    // Content drives the real height (see the window:resize IPC handler); this
    // is just a sensible first-frame size before the renderer reports back.
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    icon: appIconPath(),
    webPreferences: {
      // Compiled preload script lives next to the main bundle.
      preload: path.join(__dirname, 'preload.js'),
      // Allow <webview> for view-plugin UIs; each one is locked down in
      // will-attach-webview below.
      webviewTag: true,
    },
  });

  lockDownPluginWebviews(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Show once the renderer has painted (avoids a white flash) — unless launched
  // at login with `--hidden`, where we stay in the background until the hotkey.
  const startHidden = process.argv.includes('--hidden');
  mainWindow.once('ready-to-show', () => {
    if (startHidden) return;
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Launcher behaviour: hide when focus is lost (clicking outside). Stay open
  // while a plugin webview is active, or when the blur was caused by clicking
  // INTO the detached DevTools during dev — checking *focused*, not merely
  // *opened*, so a real outside click still closes the launcher in dev.
  mainWindow.on('blur', () => {
    if (launcherInPluginMode) return;
    if (!mainWindow?.webContents.isDevToolsFocused()) {
      mainWindow?.hide();
    }
  });

  // Let the renderer reset its query/focus each time the window appears.
  mainWindow.on('show', () => {
    mainWindow?.webContents.send('window:shown');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
};

/**
 * Defense-in-depth for plugin <webview>s: force-lock their security prefs and
 * inject our sandboxed preload regardless of what the DOM requested, restrict
 * the source to the plugin:// scheme, bind each guest to its plugin id by its
 * committed origin, and block navigation off that origin. Applied to every
 * window that hosts plugin webviews (the launcher and detached plugin windows).
 */
export function lockDownPluginWebviews(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.preload = path.join(__dirname, 'plugin-preload.js');
    if (!params.src || !params.src.startsWith('plugin://')) {
      event.preventDefault(); // only our own scheme may load
      return;
    }
    // The webview runs on its own partition session, which needs the plugin://
    // handler installed before it loads (the default-session handler doesn't
    // apply). Without this the scheme falls through to the OS as an external
    // protocol ("open this link with…").
    if (params.partition) {
      registerPluginProtocolOn(session.fromPartition(params.partition));
    }
  });

  win.webContents.on('did-attach-webview', (_event, guest) => {
    webviewHost.set(guest.id, win);
    const bind = (url: string) => {
      try {
        const host = new URL(url).hostname;
        if (host) webviewPlugin.set(guest.id, host);
      } catch {
        /* non-plugin URL — ignore */
      }
    };
    bind(guest.getURL());
    guest.on('did-navigate', (_e, url) => bind(url));

    // Block navigation away from the plugin's own plugin:// origin.
    const guard = (e: Electron.Event, url: string) => {
      const current = webviewPlugin.get(guest.id);
      try {
        const u = new URL(url);
        if (u.protocol !== 'plugin:' || (current && u.hostname !== current)) {
          e.preventDefault();
        }
      } catch {
        e.preventDefault();
      }
    };
    guest.on('will-navigate', guard);
    guest.on('will-redirect', guard);
    guest.once('destroyed', () => {
      webviewPlugin.delete(guest.id);
      webviewHost.delete(guest.id);
    });
  });
}

/** Bring the launcher to the foreground (used when a second instance starts). */
export const showMainWindow = (): void => {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
};

/** Toggle the launcher window's visibility (bound to a global shortcut). */
export const toggleMainWindow = (): void => {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
};
