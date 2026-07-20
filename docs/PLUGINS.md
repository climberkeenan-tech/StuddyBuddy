# Plugin & extensibility guide

Every major capability in StuddyBuddy is contributed through a **typed extension point**. The
built‑in features register through the exact same registry a third‑party plugin would, which means
the system is genuinely extensible — not extensible‑in‑theory.

## Extension points

| Point (`ExtensionPointId`) | Interface | What it adds |
|---|---|---|
| `ai-provider` | `AIProvider` | A new LLM backend for analysis + generation |
| `embedding-provider` | `EmbeddingProvider` | A new embedding model for semantic search |
| `transcription-provider` | `TranscriptionProvider` | A new speech‑to‑text engine |
| `material-generator` | `MaterialGenerator` | A new study‑material type (or a better generator for an existing one) |
| `exporter` | `SlideExporter` | A new slide export format |
| `visualization` | `VisualizationDescriptor` | A new interactive visualization |

## The registry

`PluginRegistry` (in `packages/core/src/plugins/registry.ts`) lets a plugin register a manifest and
contribute implementations to one or more points:

```ts
registry.register(
  {
    id: 'my-cool-plugin',
    name: 'My Cool Plugin',
    version: '1.0.0',
    description: 'Adds a Cohere AI provider',
    author: 'you',
    contributes: ['ai-provider'],
    builtIn: false,
  },
  (ctx) => {
    ctx.contribute('ai-provider', 'cohere', new CohereProvider(deps));
  },
);
```

- Registration is transactional: if a plugin's `setup` throws, its partial contributions are rolled
  back and the app keeps running.
- Contributions are keyed (e.g. `'cohere'`), and duplicate keys for the same point are rejected.
- Built‑in plugins can't be disabled; third‑party plugins can be toggled in **Settings → Plugins**.

## Example: a new AI provider

Implement the `AIProvider` interface:

```ts
import type { AIProvider, ChatRequest, ChatResult } from '@studdybuddy/core';

export class CohereProvider implements AIProvider {
  readonly info = {
    id: 'cohere',
    name: 'Cohere',
    description: 'Cohere Command models',
    requiresApiKey: true,
    defaultModel: 'command-r-plus',
    models: ['command-r-plus', 'command-r'],
  };

  constructor(private deps: { getApiKey: () => Promise<string | null>; logger: Logger }) {}

  async isConfigured() {
    return !!(await this.deps.getApiKey());
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    // call the Cohere API with fetch; map errors to SbError; return { text, model, usage }
  }

  async test() {
    // a cheap round‑trip; return { ok, message }
  }
}
```

Then register it (see above). Once registered it appears in **Settings → AI Providers** and can be
selected as the active provider — no other code changes required, because every feature talks to the
provider only through the `AIFacade` and registry.

## Example: a new material generator

Implement `MaterialGenerator` for a `MaterialType`:

```ts
import type { MaterialGenerator, GenerationContext } from '@studdybuddy/core';

export const mnemonicGenerator: MaterialGenerator<'cheat-sheet'> = {
  type: 'cheat-sheet',
  name: 'Mnemonic cheat sheet',
  async generate(ctx: GenerationContext) {
    if (ctx.aiAvailable) {
      // use ctx.generate(...) with a Zod schema for structured output
    }
    // otherwise derive deterministically from ctx.analysis
    return { title: 'Mnemonics', content: { markdown: '…' } };
  },
};
```

Every generator must implement **both** paths — an AI path (`ctx.aiAvailable === true`, via
`ctx.generate`) and a deterministic heuristic path — so the feature works offline.

## Example: a new exporter

Implement `SlideExporter` for a `SlideExportFormat` and contribute it to `exporter`. It receives the
`SlideDeck` and an output path and returns the written file path.

## Design notes for plugin authors

- **Stay within the interface.** Features depend on the interfaces, not your concrete class, so a
  well‑behaved plugin is a drop‑in.
- **Fail soft.** Map network/parse failures to `SbError` with a helpful message; the app surfaces it
  as a toast rather than crashing.
- **Never require a key to load.** Providers should construct without credentials and report
  readiness via `isConfigured()`; the registry falls back gracefully when a provider isn't ready.
- **Respect privacy.** Only send what a request needs, and never persist secrets outside the vault.
