import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Standalone web build of the renderer for a shareable, install-free preview.
 * Outside Electron the renderer falls back to its in-memory mock backend
 * (see lib/api.ts), so this produces a fully interactive demo. Everything is
 * bundled into a single JS + CSS pair (no code-splitting, all assets inlined)
 * so the result can be inlined into one self-contained HTML file.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@studdybuddy/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 100_000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
