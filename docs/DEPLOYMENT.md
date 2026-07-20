# Deployment guide

StuddyBuddy ships as a desktop application built with **electron‑vite** (bundling) and
**electron‑builder** (installers).

## Build

```bash
pnpm build       # compile main, preload, and renderer into apps/desktop/out
```

The output in `apps/desktop/out` is a runnable Electron app (used by `electron-vite preview`).

## Package installers

```bash
pnpm package     # electron-vite build + electron-builder for the current OS
```

Artifacts are written to `apps/desktop/release/`. Targets (configured in
`apps/desktop/electron-builder.yml`):

| Platform | Targets |
|---|---|
| macOS | `dmg`, `zip` (category: Education) |
| Windows | `nsis` installer |
| Linux | `AppImage`, `deb` (category: Education) |

Build each platform's installers on that platform (or in a matching CI runner). Cross‑compiling
Electron apps is not recommended.

## Continuous integration

A typical pipeline:

```yaml
# .github/workflows/ci.yml (illustrative)
jobs:
  verify:
    strategy:
      matrix: { os: [ubuntu-latest, macos-latest, windows-latest] }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

Add a release job that runs `pnpm package` on each OS and uploads `apps/desktop/release/*` when a
version tag is pushed.

## Code signing & notarization

For distribution outside a dev machine:

- **macOS:** configure signing identity + notarization credentials for electron‑builder (Apple
  Developer ID). Set the standard `CSC_LINK`, `CSC_KEY_PASSWORD`, and notarization env vars in CI.
- **Windows:** provide a code‑signing certificate (`CSC_LINK` / `CSC_KEY_PASSWORD`).

These are supplied via CI secrets and never committed.

## Versioning & auto‑update

- Bump the version in the root and `apps/desktop` `package.json`.
- To enable auto‑updates later, add `electron-updater` and a `publish` block to
  `electron-builder.yml` pointing at your release host (e.g. GitHub Releases). The app is structured
  so this is an additive change.

## Runtime data & privacy in production

StuddyBuddy is local‑first: user data stays in the OS app‑data directory on the user's machine. No
telemetry is collected. API keys remain in the encrypted local vault. If you add optional cloud sync
in the future, gate it behind explicit user opt‑in and document exactly what leaves the device.
