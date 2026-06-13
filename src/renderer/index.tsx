import { JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Settings } from './pages/Settings';
import { PluginWindow } from './pages/PluginWindow';
import { applyTheme } from './lib/theme';
import './index.css';

// Apply the saved theme as early as possible, then keep both windows in sync
// when settings change.
window.launcher.getSettings().then((s) => applyTheme(s.theme));
window.launcher.onSettingsChanged((s) => applyTheme(s.theme));

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found');
}

// One bundle, three roots, selected by hash route: the launcher (default), the
// settings window (#/settings), and a detached plugin window (#/plugin/<id>).
const { hash } = window.location;
let root: JSX.Element;
if (hash.startsWith('#/settings')) {
  document.title = 'ORC';
  root = <Settings />;
} else if (hash.startsWith('#/plugin/')) {
  root = <PluginWindow />; // sets its own title from the plugin name
} else {
  document.title = 'orccode';
  root = <App />;
}
createRoot(container).render(root);
