# Installation guide

## Requirements

| Tool | Version | Why |
|---|---|---|
| **Node.js** | **≥ 22.13** | StuddyBuddy uses Node's built‑in `node:sqlite` for local storage. |
| **pnpm** | ≥ 9 | Workspace package manager. Install with `npm i -g pnpm` or `corepack enable`. |
| **ffmpeg** | optional | Only needed for local `whisper.cpp` transcription. |

Supported platforms: macOS, Windows, and Linux (x64 / arm64).

## Install

```bash
git clone <your-fork-url> StuddyBuddy
cd StuddyBuddy
pnpm setup
```

`pnpm setup` verifies your Node/pnpm versions, installs all workspace dependencies (including the
Electron runtime), and reports whether optional tools like ffmpeg are available. If you prefer to do
it manually:

```bash
pnpm install
```

## Run it

```bash
pnpm dev
```

The app opens in development mode with hot reload. On first launch it is fully usable offline:

- **Import a demo lecture** — open a class and click *Import demo lecture* to run the entire
  pipeline (transcript → analysis → notes → flashcards → quiz → slides) with no mic or API key.
- **Record for real** — click *Record*, choose a class, and start. StuddyBuddy captures your
  built‑in microphone and transcribes live.

## Enabling cloud AI (optional)

StuddyBuddy works offline, but cloud models produce richer materials. In **Settings → AI Providers**:

1. Pick a provider — **Anthropic**, **OpenAI**, or **Google Gemini** — and paste an API key, or run
   a **local Ollama** model (no key needed; just have Ollama running).
2. Click **Test** to verify connectivity.
3. Select it as your active provider.

Keys are stored encrypted in a local vault (OS keychain via Electron `safeStorage` when available,
otherwise an AES‑256‑GCM key file with `0600` permissions). They are **never** written to logs,
settings, or backups.

### High‑quality transcription (optional)

- **OpenAI Whisper API** — set your OpenAI key and choose it under *Settings → Transcription*.
- **Local whisper.cpp** — fully on‑device. Point StuddyBuddy at your `whisper.cpp` binary and a model
  file; ffmpeg on your PATH is used to prepare audio.

## Where your data lives

All data is stored locally under your OS application‑data directory (shown in *Settings → Data &
Backup*), for example:

- macOS: `~/Library/Application Support/StuddyBuddy`
- Windows: `%APPDATA%\StuddyBuddy`
- Linux: `~/.config/StuddyBuddy`

Use **Settings → Data & Backup → Backup now** to export a portable snapshot (transcripts, notes,
materials, and analysis — API keys are intentionally excluded), and **Restore** to import one.

## Troubleshooting

- **“Node 22.13+ required.”** Upgrade Node (via [nodejs.org](https://nodejs.org) or `nvm`). The
  built‑in SQLite engine is only available on recent Node; StuddyBuddy automatically falls back to a
  JSON‑file store if SQLite can't load, but a modern Node is recommended.
- **Microphone permission denied.** Grant mic access in your OS privacy settings, then reopen the
  Record screen. You can always use *Import demo lecture* without a microphone.
- **AI test fails with an auth error.** Re‑check the API key in *Settings → AI Providers*. The app
  stays fully functional offline in the meantime.
- **`pnpm install` fails downloading Electron.** Ensure network access, then re‑run `pnpm install`.
  Behind a proxy, set `ELECTRON_GET_USE_PROXY=true` and the standard `HTTPS_PROXY` variable.
