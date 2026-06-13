import { globalShortcut } from 'electron';
import { toggleMainWindow } from '../windows/mainWindow';
import { getToggleHotkey } from '../settings';
import { setSetting } from '../../core/database';

/**
 * Application-wide global shortcut for summoning / hiding the launcher. The
 * accelerator is configurable via settings (default `Alt+Space`).
 */

let current = '';

/** Try to bind `accel`; updates `current` only on success. */
function bind(accel: string): boolean {
  try {
    const ok = globalShortcut.register(accel, () => toggleMainWindow());
    if (ok) current = accel;
    return ok;
  } catch {
    return false; // invalid accelerator string
  }
}

export function registerGlobalShortcuts(): void {
  bind(getToggleHotkey());
}

/**
 * Rebind the toggle hotkey. Validates by registering; on failure the previous
 * binding is restored and `false` is returned. Persists on success.
 */
export function setToggleHotkey(accel: string): boolean {
  const previous = current;
  if (previous) globalShortcut.unregister(previous);

  if (!bind(accel)) {
    if (previous) bind(previous); // restore the working binding
    return false;
  }

  setSetting('toggleHotkey', accel);
  return true;
}

/** Release all registered global shortcuts (call on app quit). */
export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
  current = '';
}
