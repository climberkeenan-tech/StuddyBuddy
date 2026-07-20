# StuddyBuddy — contributor notes

AI lecture-companion desktop app (Electron + React). A pnpm monorepo.

## Where things live
- `packages/shared` — domain types + the typed IPC contract (`ipc/contract.ts`). Single source of
  truth; changing it is a compile error on both sides until they agree.
- `packages/core` — headless services (storage, ai, transcription, analysis, materials, memory,
  slides, export, review, gamification). **No Electron imports here** — host capabilities arrive via
  `CoreEnv` / injected deps, which is what keeps it unit-testable under Node.
- `apps/desktop` — Electron `main` (window + `bootstrap()` + `runtime.ts` service wiring + IPC
  router/event bridge), `preload` (typed bridge generated from `IPC_SURFACE`), and the React
  `renderer` (design system, stores, feature pages). The renderer talks to the backend only through
  `lib/api`, which swaps in an in-memory mock outside Electron.

## Golden rules
- Offline-first: every AI feature has a deterministic heuristic fallback gated on
  `AIFacade.available()`. The app must work with zero API keys.
- Never log secrets; API keys live only in the encrypted `SecretsVault`.
- Renderer uses design tokens only (`bg-surface`, `text-t1`, `bg-primary`, `glass-panel`, the motion
  variants) — no hardcoded hex.
- Add a backend method by editing `IpcApi` + `IPC_SURFACE` in shared, implementing it in
  `runtime.ts`, and calling `api.<group>.<method>` from the renderer.

## Commands
```
pnpm dev        # run the app
pnpm test       # Vitest (node + jsdom projects)
pnpm typecheck  # all packages
pnpm lint
pnpm build      # electron-vite production build
```

See `docs/` for architecture, install, development, deployment, and plugin guides.
