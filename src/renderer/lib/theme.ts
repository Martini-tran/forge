import type { Theme } from '../../shared/Settings';

/**
 * Apply a theme by toggling the `light`/`dark` class on <html>. `system`
 * resolves via `prefers-color-scheme` and keeps tracking OS changes until a
 * different theme is applied.
 */

let media: MediaQueryList | null = null;
let mediaListener: (() => void) | null = null;

export function applyTheme(theme: Theme): void {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;

  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);

  // Stop tracking the previous mode, then (re)subscribe only for 'system'.
  if (media && mediaListener) media.removeEventListener('change', mediaListener);
  media = null;
  mediaListener = null;
  if (theme === 'system') {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    mediaListener = () => applyTheme('system');
    media.addEventListener('change', mediaListener);
  }
}
