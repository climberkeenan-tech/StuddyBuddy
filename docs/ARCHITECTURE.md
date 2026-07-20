# Architecture

StuddyBuddy is designed as if it were a commercial educational product: modular, scalable, and
extensible. This document explains how the pieces fit together and where to extend them.

## Guiding principles

1. **One source of truth for contracts.** All domain types and the entire renderer↔main API live in
   `packages/shared`. Both processes compile against it, so a contract change is a compile error on
   every side that hasn't caught up.
2. **Headless, testable core.** `packages/core` contains every service (storage, AI, transcription,
   analysis, materials, memory, slides, review, gamification) and imports **no Electron APIs**. It
   runs — and is unit‑tested — under plain Node. The desktop app injects host capabilities (data
   directory, secret encryption, logging) through a small `CoreEnv` seam.
3. **Local‑first.** Data is persisted on the user's machine first. Cloud sync is a future adapter,
   not a dependency.
4. **Offline‑capable.** Every AI‑powered feature has a deterministic heuristic fallback, so the app
   is fully functional with zero API keys. Adding a provider key upgrades quality; it is never
   required.
5. **Everything major is a plugin.** Providers, generators, and exporters register through typed
   extension points. Built‑ins use the same registry a third party would.

## Process model

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                   │
│  Main process (Node)                Renderer (Chromium)           │
│  ┌───────────────────────┐          ┌──────────────────────────┐  │
│  │ bootstrap()           │          │ React app                │  │
│  │  • CoreEnv (dataDir,  │          │  • design system         │  │
│  │    safeStorage, log)  │          │  • Zustand stores        │  │
│  │  • core runtime       │          │  • feature pages         │  │
│  │  • IpcApi impl        │          │                          │  │
│  │  • IPC router  ───────┼──invoke──┼─▶ window.studdybuddy.api │  │
│  │  • event bridge ──────┼──events──┼─▶ window.studdybuddy...  │  │
│  └───────────────────────┘          └──────────────────────────┘  │
│         │  preload (contextIsolation, sandboxed bridge)            │
└───────────────────────────────────────────────────────────────────┘
```

- **Preload** builds the `window.studdybuddy` bridge purely from the shared `IPC_SURFACE` table —
  no per‑method boilerplate. Results cross the boundary in an `{ ok, value | error }` envelope so
  structured `AppError`s (code, retryable) survive; the preload rehydrates them into thrown Errors.
- **IPC router** (`apps/desktop/src/main/ipc-router.ts`) registers every `<group>.<method>` from the
  contract against the `IpcApi` implementation and fails loudly at startup if the implementation and
  contract have drifted.
- **Event bridge** forwards in‑process `CoreEvents` (recording status, live segments, job progress,
  achievements) 1:1 to renderer push channels, keeping core Electron‑free.

## Data flow: from microphone to knowledge base

```
                 ┌─────────────┐
 mic audio ─────▶│  Recording  │  chunks + levels (renderer → main)
                 │  Service    │
                 └──────┬──────┘
                        │ live segments
                        ▼
              ┌───────────────────┐   punctuation · paragraphs · pauses
              │  Transcript       │   headings · question detection
              │  pipeline (stages)│
              └────────┬──────────┘
                       │ Transcript (sections/paragraphs/segments)
        ┌──────────────┼───────────────────────────┐
        ▼              ▼                             ▼
 ┌────────────┐  ┌────────────┐              ┌───────────────┐
 │  Analysis  │  │  Knowledge │              │  (stored)     │
 │  engine    │  │  indexer   │──embeddings─▶│  vector store │
 └─────┬──────┘  └────────────┘              └───────────────┘
       │ LectureAnalysis (concepts, formulas, exam likelihood, cross‑lecture links)
       ▼
 ┌────────────────────────────────────────────────────────────┐
 │  Materials · Slides · Review · Gamification                 │
 │  notes, summaries, flashcards, quizzes, decks, exam prep    │
 └────────────────────────────────────────────────────────────┘
```

When a recording stops, `RecordingService` finalizes the transcript and invokes an
`onLectureFinalized` callback (wired during bootstrap) that runs analysis, generates the study kit,
and indexes the lecture for search — emitting `job:progress` events throughout and a final
`lecture:ready`.

## Packages

### `packages/shared`
- `types/*` — the domain model (courses, lectures, transcripts, analysis, materials, slides, memory,
  gamification, settings, plugins, dashboard).
- `ipc/contract.ts` — the `IpcApi` interface, `IpcEventMap`, and the runtime `IPC_SURFACE` table the
  preload/router build from.
- `utils/*` — id, time, and text helpers shared by both processes.

### `packages/core`
- `env.ts` — the `CoreEnv` host seam (dataDir, `SecretsCrypto`, logger, appVersion).
- `infra/` — leveled logger with transports + ring buffer, typed event bus, `SbError` + error codes,
  retry with exponential backoff + jitter, and the `CoreEvents` map.
- `plugins/registry.ts` — the typed extension‑point registry.
- `settings/` — the settings service and the encrypted secrets vault.
- One directory per domain service (see the tree in the README). Each exposes documented factories
  and depends only on injected interfaces (repositories, facades) — never on concrete adapters.

### `apps/desktop`
- `src/main` — window lifecycle, `bootstrap()` service wiring, IPC router, event bridge.
- `src/preload` — the context‑isolated bridge + `window.studdybuddy` typings.
- `src/renderer` — the design system, app shell, Zustand stores, and feature pages. The renderer
  talks to the backend only through `lib/api`, which transparently swaps in an in‑memory mock when
  running in a browser or under tests.

## Storage

Documents are stored in named collections through a `StorageAdapter`:

- **SqliteAdapter** (default) — Node's built‑in `node:sqlite`, WAL mode, one table per collection
  with real indexed columns for hot query fields.
- **JsonFileAdapter** (fallback) — one JSON file per collection; zero native dependencies.

Feature services depend on typed **repositories**, never on an adapter directly, so the backing
store is swappable (a Postgres/Chroma adapter for cloud sync would slot in here). Cascade deletes
keep derived artifacts (transcript, analysis, materials, chunks, embeddings) consistent.

## AI layer

A single `AIFacade` fronts the active provider. Providers (`anthropic`, `openai`, `gemini`,
`ollama`, `mock`) implement one `AIProvider` interface; a registry handles selection, credential
lookup from the vault, and fallback to the offline mock. Structured generation goes through one
`createStructuredGenerator` path that prompts for JSON, extracts it from noisy responses, validates
it against a Zod schema, and repairs on failure. `AIFacade.available()` is the switch every feature
consults to choose its AI path vs. its heuristic path.

## Memory / RAG

The knowledge base chunks transcripts, analysis, and notes, embeds them (offline `local-hash` by
default; OpenAI/Ollama when configured), and indexes them in a `VectorStore`. Semantic search and
the “Ask your lectures” Q&A retrieve the most relevant chunks and either synthesize a cited answer
via the LLM or produce an extractive cited answer offline.

## Extension points

| Point | Interface | Built‑ins |
|---|---|---|
| `ai-provider` | `AIProvider` | Anthropic, OpenAI, Gemini, Ollama, mock |
| `embedding-provider` | `EmbeddingProvider` | local‑hash, OpenAI, Ollama |
| `transcription-provider` | `TranscriptionProvider` | simulated (demo), OpenAI Whisper, whisper.cpp |
| `material-generator` | `MaterialGenerator` | notes, summaries, flashcards, quizzes, … |
| `exporter` | `SlideExporter` | PPTX, PDF, Markdown, NotebookLM |
| `visualization` | descriptor | mind map, concept map, timeline |

See [PLUGINS.md](PLUGINS.md) for how to add one.

## Testing strategy

- **Node project** (`packages/*/test/**`) — services tested headlessly with temp dirs and in‑memory
  fakes; adapters tested against a shared contract suite.
- **Renderer project** (jsdom) — components and pages tested against the in‑memory mock API.

Both run under a single Vitest workspace (`vitest.workspace.ts`); `pnpm test` runs everything.
