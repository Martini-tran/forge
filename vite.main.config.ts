import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      // Object entry → output is named after the key (`main.js`), not the
      // source basename (`index`). Keeps package.json "main" (.vite/build/main.js)
      // valid now that the entry lives at src/main/index.ts.
      entry: { main: 'src/main/index.ts' },
      fileName: () => '[name].js',
      formats: ['cjs'],
    },
    rollupOptions: {
      // node:sqlite is a builtin of Electron's Node (24), but the Node running
      // this build (22) doesn't list it, so it isn't auto-externalized. Mark it
      // external so it's `require`d at runtime rather than bundled.
      external: ['node:sqlite'],
    },
  },
});
