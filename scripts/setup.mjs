#!/usr/bin/env node
/**
 * One-shot environment check + install helper.
 *   pnpm setup   (or: node scripts/setup.mjs)
 * Verifies toolchain versions, installs dependencies, and prints next steps.
 */
import { execSync } from 'node:child_process';

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 13;

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim();
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

console.log('┌──────────────────────────────────────────┐');
console.log('│  StuddyBuddy setup                        │');
console.log('└──────────────────────────────────────────┘');

// 1. Node version — node:sqlite (the default storage engine) needs >= 22.13.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < MIN_NODE_MINOR)) {
  fail(
    `Node ${process.versions.node} found — StuddyBuddy needs >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} ` +
      '(built-in SQLite). Install via https://nodejs.org or nvm.',
  );
}
console.log(`✔ Node ${process.versions.node}`);

// 2. pnpm
try {
  console.log(`✔ pnpm ${run('pnpm --version')}`);
} catch {
  fail('pnpm not found. Install with: npm install -g pnpm  (or corepack enable)');
}

// 3. Install workspace dependencies (includes the Electron binary).
console.log('\nInstalling dependencies (this can take a few minutes the first time)…');
try {
  execSync('pnpm install', { stdio: 'inherit' });
} catch {
  fail('pnpm install failed — see output above.');
}

// 4. Optional tools that unlock extra features.
let ffmpeg = false;
try {
  run('ffmpeg -version');
  ffmpeg = true;
} catch {
  /* optional */
}
console.log(
  ffmpeg
    ? '✔ ffmpeg found (local whisper.cpp transcription available)'
    : 'ℹ ffmpeg not found — optional; only needed for local whisper.cpp transcription',
);

console.log(`
All set! Next steps:

  pnpm dev          start the app in development mode
  pnpm test         run the test suite
  pnpm build        production build
  pnpm package      build platform installers (electron-builder)

First run tips:
  • The app works fully offline out of the box (demo voice + offline study
    tools). Add an API key in Settings → AI Providers to unlock cloud AI.
  • Try "Import demo lecture" on any class to see the whole pipeline.
`);
