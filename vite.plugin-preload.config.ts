import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Object input → output is named after the key (`plugin-preload.js`), kept
      // distinct from the launcher preload. Loaded by each plugin <webview> via
      // path.join(__dirname, 'plugin-preload.js').
      input: { 'plugin-preload': 'src/preload/plugin.ts' },
    },
  },
});
