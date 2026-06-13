import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Tailwind is wired via PostCSS (postcss.config.mjs) rather than the
// @tailwindcss/vite plugin, which is ESM-only and can't be required by this
// CommonJS project's Vite config loader.
export default defineConfig({
  // Transpile JSX/TSX with the React 17+ automatic runtime via esbuild,
  // avoiding an extra @vitejs/plugin-react dependency.
  esbuild: {
    jsx: 'automatic',
  },
});
