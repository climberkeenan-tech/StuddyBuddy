/**
 * Bundled demo lecture (sample transcript + timing) powering the zero-setup
 * demo mode. The simulated transcription provider replays DEMO_LECTURE, and
 * importDemoLecture persists it as a fully-structured lecture + transcript.
 */
export { DEMO_LECTURE, type DemoLecture, type DemoUtterance } from './demo-lecture';
export { importDemoLecture, type ImportDemoOptions } from './import-demo';
