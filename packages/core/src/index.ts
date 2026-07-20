/**
 * @studdybuddy/core — headless domain services.
 *
 * Layout:
 *   env.ts            host-environment abstraction (no Electron imports here)
 *   infra/            logging, event bus, errors, retry
 *   plugins/          typed extension-point registry
 *   settings/         settings + encrypted secrets vault
 *   storage/          document store adapters + repositories + backup
 *   ai/               LLM provider abstraction + structured generation
 *   transcription/    live transcription pipeline + providers
 *   analysis/         AI lecture understanding
 *   materials/        study material generators
 *   memory/           embeddings, vector store, RAG knowledge base
 *   slides/           slide deck generation
 *   export/           deck exporters (pptx/pdf/markdown/notebooklm)
 *   review/           SM-2 scheduling, weak areas, exam prep
 *   gamification/     XP, streaks, achievements
 *   demo/             bundled sample lecture for zero-setup demo mode
 */
export * from './env';
export * from './infra/logger';
export * from './infra/event-bus';
export * from './infra/errors';
export * from './infra/retry';
export * from './plugins/registry';
export * from './settings/settings-service';
export * from './settings/secrets-vault';
export * from './storage/index';
export * from './ai/index';
export * from './transcription/index';
export * from './analysis/index';
export * from './materials/index';
export * from './memory/index';
export * from './slides/index';
export * from './export/index';
export * from './review/index';
export * from './gamification/index';
export * from './demo/index';
