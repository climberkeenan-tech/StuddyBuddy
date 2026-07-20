# Development guide

## Layout

```
packages/shared    domain types + IPC contract (imported everywhere)
packages/core      headless services + unit tests (Node)
apps/desktop       Electron main, preload, and React renderer
```

Workspace packages are consumed as **TypeScript source** (via path aliases in
`electron.vite.config.ts` and each `tsconfig`), so there's no separate build step for
`packages/*` during development — edit and go.

## Everyday commands

```bash
pnpm dev            # run the app with hot reload
pnpm test           # full test suite (Node + jsdom projects)
pnpm test:watch     # watch mode
pnpm typecheck      # typecheck every package
pnpm lint           # eslint
pnpm format         # prettier --write
```

Run a single package's tests:

```bash
pnpm --filter @studdybuddy/core test
npx vitest run --project renderer          # renderer only
npx vitest run packages/core/test/storage  # a subset by path
```

## Coding standards

- **TypeScript strict**, with `noUncheckedIndexedAccess` — indexed access is `T | undefined`; handle
  it. Prefer explicit types at module boundaries.
- **No Electron imports in `packages/core`.** Anything host‑specific is injected via `CoreEnv` or a
  constructor dependency. This is what keeps core unit‑testable.
- **Errors:** throw `SbError` with a stable `ErrorCodes` value; only `AppError`‑shaped data crosses
  IPC. Never log secrets.
- **Logging:** use the injected `Logger` with child scopes (`logger.child('recording')`).
- **Styling:** the renderer uses design tokens only — Tailwind utilities like `bg-surface`,
  `text-t1`, `border-stroke`, `bg-primary`, the `glass-panel` class, and the provided Framer Motion
  variants (which already respect reduced motion). Never hardcode hex colors.
- **Comments** explain *why*, not *what*; JSDoc every exported symbol.

## Adding a backend method (end‑to‑end)

1. Add the method to the relevant group in `packages/shared/src/ipc/contract.ts` (`IpcApi`) **and**
   to the `IPC_SURFACE` table.
2. Implement it in the corresponding `IpcApi` object built during `bootstrap()`.
3. Call it from the renderer via `api.<group>.<method>(...)` — it's fully typed, and the preload
   already exposes it (the bridge is generated from `IPC_SURFACE`).

If the implementation and contract drift, the IPC router throws at startup naming the missing
method — a fast, obvious failure instead of a silent one.

## Adding a push event

1. Add it to `IpcEventMap` (shared) and `CoreEvents` (core).
2. Add the event name to the bridge list in `apps/desktop/src/main/event-bridge.ts`.
3. Emit it from a service via the injected event bus; subscribe in the renderer with
   `onEvent('name', handler)` or the `useIpcEvent` hook.

## The renderer mock API

`apps/desktop/src/renderer/src/lib/api.ts` uses the real `window.studdybuddy` bridge inside Electron
and an in‑memory mock (`lib/mock-api.ts`) everywhere else. That means:

- You can develop and test the whole UI in a browser/jsdom with realistic seeded data.
- Every component test runs against the mock — no Electron needed.

Keep the mock in sync with the contract: it implements the full `IpcApi`.

## Tests

- **Core services** live in `packages/core/test/*.test.ts` (Node). Use `fs.mkdtemp` for temp data
  dirs and the in‑memory repository fakes where a full store isn't needed.
- **Renderer** tests are colocated `*.test.tsx` (jsdom) and run against the mock API with Testing
  Library + user‑event.

## Debugging

- Main‑process logs stream to the terminal running `pnpm dev`; the in‑app **Settings → About /
  Diagnostics** panel shows recent log lines via `system.getLogs`.
- Renderer DevTools open with the usual shortcut in the dev build.
