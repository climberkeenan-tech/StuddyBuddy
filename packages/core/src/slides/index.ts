/**
 * Slide-deck generation.
 *
 * {@link SlidesService} turns a lecture's analysis + transcript into a
 * persisted {@link import('@studdybuddy/shared').SlideDeck}. It upgrades to a
 * full AI-designed deck when a provider is configured and otherwise builds a
 * genuinely useful deck deterministically (offline-first). The Mermaid helpers
 * and the raw-deck zod schemas are exported for reuse and testing.
 */
export * from './schemas';
export * from './mermaid-gen';
export * from './slides-service';
