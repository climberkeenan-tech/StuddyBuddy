import { resolve } from 'node:path';
import { defineWorkspace } from 'vitest/config';

const aliases = {
  '@studdybuddy/shared': resolve(import.meta.dirname, 'packages/shared/src/index.ts'),
  '@studdybuddy/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
  '@renderer': resolve(import.meta.dirname, 'apps/desktop/src/renderer/src'),
};

export default defineWorkspace([
  {
    test: {
      name: 'node',
      environment: 'node',
      include: ['packages/*/test/**/*.test.ts', 'apps/desktop/src/main/**/*.test.ts'],
      passWithNoTests: true,
    },
    resolve: { alias: aliases },
  },
  {
    test: {
      name: 'renderer',
      environment: 'jsdom',
      include: ['apps/desktop/src/renderer/**/*.test.{ts,tsx}'],
      passWithNoTests: true,
      setupFiles: ['apps/desktop/src/renderer/test/setup.ts'],
    },
    resolve: { alias: aliases },
    esbuild: { jsx: 'automatic' },
  },
]);
