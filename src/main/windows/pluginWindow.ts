import { BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import { getTheme } from '../settings';
import { getSetting, setSetting } from '../../core/database';
import { appIconPath } from '../icon';
import { lockDownPluginWebviews } from './mainWindow';
import { discoverPlugins } from '../plugins/discover';

/**
 * Detached plugin windows. A view plugin can be popped out of the launcher into
 * its own normal, framed, resizable window that lives independently of the
 * launcher (it stays open when the launcher hides). The window loads the SAME
 * renderer bundle at the `#/plugin/<id>` route, which hosts the plugin's UI in
 * the same locked-down <webview> the inline view uses — so all of the plugin://
 * sandboxing is reused, not reimplemented.
 *
 * Each window can be pinned above all other applications, takes its initial
 * size from the plugin's manifest (`window.width/height`), and remembers the
 * user's last position, size, and pin state across opens (persisted in the
 * settings KV).
 */

// Always-on-top "level" that floats above normal windows and most other
// always-on-top windows (and, with visibleOnFullScreen, over fullscreen apps).
const ON_TOP_LEVEL = 'screen-saver' as const;

const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 560;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

// One window per plugin: reopening a detached plugin focuses the existing one.
const pluginWindows = new Map<string, BrowserWindow>();

const boundsKey = (id: string): string => `pluginWindow:${id}:bounds`;
const onTopKey = (id: string): string => `pluginWindow:${id}:onTop`;

/** The plugin id a detached window belongs to, or undefined. */
export function pluginIdForWindow(win: BrowserWindow): string | undefined {
  for (const [id, w] of pluginWindows) {
    if (w === win) return id;
  }
  return undefined;
}

/** True if `win` is a detached plugin window (used to route plugin:close). */
export function isPluginWindow(win: BrowserWindow): boolean {
  return pluginIdForWindow(win) !== undefined;
}

/** Last saved window bounds for a plugin, or null. */
function savedBounds(id: string): Partial<Electron.Rectangle> | null {
  const raw = getSetting(boundsKey(id));
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Partial<Electron.Rectangle>;
    const ok = (n: unknown): n is number => typeof n === 'number' && isFinite(n);
    if (!ok(b.width) || !ok(b.height)) return null;
    return b;
  } catch {
    return null;
  }
}

/** Last saved pin state for a plugin, or null if never set. */
function savedOnTop(id: string): boolean | null {
  const v = getSetting(onTopKey(id));
  return v == null ? null : v === '1';
}

function clampSize(value: number | undefined, fallback: number, min: number): number {
  if (typeof value !== 'number' || !isFinite(value)) return fallback;
  return Math.max(min, Math.round(value));
}

/** Apply the pin state: on → float above all apps (incl. fullscreen). */
function applyOnTop(win: BrowserWindow, on: boolean): void {
  if (on) win.setAlwaysOnTop(true, ON_TOP_LEVEL);
  else win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: true });
}

/** Toggle a detached window's "above all applications" pin (and remember it). */
export function setPluginWindowAlwaysOnTop(win: BrowserWindow, on: boolean): void {
  applyOnTop(win, on);
  const id = pluginIdForWindow(win);
  if (id) setSetting(onTopKey(id), on ? '1' : '0');
}

/** Current pin state of a detached window. */
export function getPluginWindowOnTop(win: BrowserWindow): boolean {
  return win.isAlwaysOnTop();
}

/** Open (or focus) the detached window for a view plugin. */
export async function openPluginWindow(id: string): Promise<void> {
  const existing = pluginWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }

  // Pull the plugin's manifest window defaults (initial size + pin default).
  const plugins = await discoverPlugins();
  const info = plugins.find((p) => p.id === id && p.type === 'view');
  const cfg = info?.window;

  const theme = getTheme();
  const dark =
    theme === 'dark' ||
    (theme === 'system' && nativeTheme.shouldUseDarkColors);

  const saved = savedBounds(id);
  const width = saved?.width ?? clampSize(cfg?.width, DEFAULT_WIDTH, MIN_WIDTH);
  const height = saved?.height ?? clampSize(cfg?.height, DEFAULT_HEIGHT, MIN_HEIGHT);
  const onTop = savedOnTop(id) ?? cfg?.alwaysOnTop ?? true;
  const placed = saved && saved.x != null && saved.y != null;

  const win = new BrowserWindow({
    width,
    height,
    ...(placed ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: info?.name ?? 'orccode',
    icon: appIconPath(),
    alwaysOnTop: onTop,
    backgroundColor: dark ? '#1c1c1c' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Hosts the plugin's UI in a <webview>, locked down below.
      webviewTag: true,
    },
  });

  win.setMenuBarVisibility(false);
  lockDownPluginWebviews(win);
  pluginWindows.set(id, win);
  applyOnTop(win, onTop); // set the on-top level + fullscreen visibility

  const route = `/plugin/${encodeURIComponent(id)}`;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${route}`);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: route },
    );
  }

  // Remember where the user puts the window, and how big they make it.
  const persistBounds = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    setSetting(boundsKey(id), JSON.stringify(win.getBounds()));
  };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);
  win.on('close', persistBounds);

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => pluginWindows.delete(id));
}
