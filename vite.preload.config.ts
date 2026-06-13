import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Object input → output is named after the key (`preload.js`) so the main
      // process can load it via path.join(__dirname, 'preload.js'), now that the
      // source lives at src/preload/index.ts.
      input: { preload: 'src/preload/index.ts' },
    },
  },
});
