import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Workspace packages are consumed as TypeScript source and bundled into each
// target (main gets core+shared, renderer gets shared) — no separate build
// step or dist syncing for packages/*.
const workspaceAliases = {
  '@studdybuddy/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
  '@studdybuddy/core': resolve(__dirname, '../../packages/core/src/index.ts'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
};

export default defineConfig({
  main: {
    resolve: { alias: workspaceAliases },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: workspaceAliases },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preload requires a CommonJS bundle.
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    resolve: { alias: workspaceAliases },
    plugins: [react()],
    // Transformers.js ships its own ESM + wasm; let Vite serve it as-is and
    // build the on-device Whisper worker as an ES module.
    optimizeDeps: { exclude: ['@huggingface/transformers'] },
    worker: { format: 'es' },
  },
});
