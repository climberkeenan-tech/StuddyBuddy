# How to run StuddyBuddy on your Mac

## The easy way — one click

1. Open the **StuddyBuddy** folder in Finder.
2. Double-click **`start.command`**.
   - The first time, macOS may say it's from an unidentified developer. If so:
     right-click `start.command` → **Open** → **Open**. (You only do this once.)
3. A Terminal window opens and sets everything up, then the app window appears.
   Leave the Terminal window open while you use the app.

## Using it

1. Click **Record** in the app.
2. The first time only, it downloads a small speech model — wait for
   **"On-device transcription ready."** (Needs internet this once; after that
   it works offline.)
3. Pick a class, tap the big red button, **talk**, then **Stop & save**.
4. Your real words become the transcript — and your notes, flashcards, and
   slides are built from them. No API key, no cloud; your audio stays on your Mac.

## If anything goes wrong

The Terminal window will show the reason. Copy that text and send it to Claude —
it'll fix it right away.

## The manual way (if you prefer the Terminal)

From inside the StuddyBuddy folder:

```
git pull origin claude/ai-lecture-companion-app-e9hnk1
pnpm install
pnpm dev
```
