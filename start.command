#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  StuddyBuddy — one-click launcher for macOS
#  Double-click this file in Finder to update, install, and run
#  the app. It opens in Terminal; leave that window open while
#  you use StuddyBuddy, and close it (or press Ctrl+C) when done.
# ─────────────────────────────────────────────────────────────

# Always run from the folder this script lives in.
cd "$(dirname "$0")" || exit 1

# Make sure Node/pnpm are findable even when launched from Finder
# (Finder doesn't load your full shell profile). Add the usual spots.
export PNPM_HOME="${PNPM_HOME:-$HOME/Library/pnpm}"
export PATH="$PNPM_HOME:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"
# Load nvm if you installed Node through it.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

echo ""
echo "════════════════════════════════════════════"
echo "   StuddyBuddy — starting up"
echo "════════════════════════════════════════════"
echo ""

# Fail loudly and keep the window open so errors are readable.
bail() {
  echo ""
  echo "⚠️  Something stopped the launch: $1"
  echo "    Copy the message above and send it to Claude — it'll fix it."
  echo ""
  echo "Press Return to close this window."
  read -r _
  exit 1
}

command -v node >/dev/null 2>&1 || bail "Node.js isn't installed (get it from nodejs.org)."
command -v pnpm >/dev/null 2>&1 || bail "pnpm isn't installed or isn't on your PATH."

BRANCH="claude/ai-lecture-companion-app-e9hnk1"

echo "→ Getting the latest working version…"
# Sync exactly to the tested version on GitHub, no matter what state this
# folder is in (this avoids merge conflicts from earlier edits). This only
# touches StuddyBuddy's own files; your recordings/notes live elsewhere.
git fetch origin "$BRANCH" || bail "couldn't reach GitHub (check your internet)."
git reset --hard "origin/$BRANCH" || bail "couldn't sync to the latest version."

echo ""
echo "→ Installing (first time takes a minute)…"
pnpm install || bail "pnpm install failed."

# pnpm skips Electron's own download step by default, which can leave the app
# unable to launch. Make sure the Electron runtime binary is present. Non-fatal:
# if it's already installed this is a quick no-op.
echo ""
echo "→ Preparing the app runtime (first run only)…"
node node_modules/electron/install.js >/dev/null 2>&1 \
  || pnpm rebuild electron >/dev/null 2>&1 \
  || echo "   (runtime prep skipped — the app will fetch it on first launch)"

echo ""
echo "→ Launching StuddyBuddy. A new app window will open."
echo "   First recording downloads a small speech model once — wait"
echo "   for 'On-device transcription ready', then talk and hit Stop."
echo ""
pnpm dev || bail "the app failed to start."
