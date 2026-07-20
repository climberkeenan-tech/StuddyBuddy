import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LogManager, type CoreEnv } from '@studdybuddy/core';
import type { IpcApi, NotesContent } from '@studdybuddy/shared';
import { createRuntime, type Runtime } from './runtime';

/**
 * End-to-end integration test for the assembled runtime — no Electron, no
 * network, no API keys. It drives the same IpcApi the renderer uses and proves
 * the full offline pipeline works: create a course, import the demo lecture,
 * and confirm analysis, study materials, slides, and semantic search all
 * produce real results, plus that recording state and gamification wire up.
 */
describe('runtime integration (offline)', () => {
  let dir: string;
  let runtime: Runtime;
  let api: IpcApi;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-runtime-'));
    const env: CoreEnv = { dataDir: dir, logManager: new LogManager(), appVersion: '0.0.0-test' };
    runtime = await createRuntime({ env });
    api = runtime.api;
  }, 30_000);

  afterAll(async () => {
    await runtime.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('starts with the offline defaults and no courses', async () => {
    const settings = await api.settings.get();
    expect(settings.aiProvider).toBe('mock');
    expect(await api.courses.list()).toHaveLength(0);
  });

  it('creates a course and lists it', async () => {
    const course = await api.courses.create({
      name: 'Biology 101',
      instructor: 'Dr. Franklin',
      semester: 'Fall 2026',
      color: '#7c6cf6',
      icon: 'dna',
    });
    expect(course.id).toBeTruthy();
    expect(await api.courses.list()).toHaveLength(1);
  });

  it('imports the demo lecture end-to-end and runs the full pipeline', async () => {
    const [course] = await api.courses.list();
    const lecture = await api.lectures.importDemo(course!.id);

    // The finalize pipeline should have completed synchronously enough to mark
    // the lecture ready with a transcript, analysis, and topics.
    const stored = await api.lectures.get(lecture.id);
    expect(stored?.status).toBe('ready');
    expect(stored?.topics.length ?? 0).toBeGreaterThan(0);

    const transcript = await api.transcripts.get(lecture.id);
    expect(transcript?.segments.length ?? 0).toBeGreaterThan(40);
    expect((transcript?.sections.length ?? 0)).toBeGreaterThan(1);

    const analysis = await api.analysis.get(lecture.id);
    expect(analysis).not.toBeNull();
    expect(analysis!.concepts.length).toBeGreaterThan(0);
  }, 30_000);

  it('generates a study material offline (notes)', async () => {
    const [course] = await api.courses.list();
    const [lecture] = await api.lectures.listByCourse(course!.id);
    const notes = await api.materials.generate(lecture!.id, 'notes');
    expect(notes.type).toBe('notes');
    expect((notes.content as NotesContent).blocks.length).toBeGreaterThan(0);
  }, 30_000);

  it('answers questions from indexed lectures with citations', async () => {
    const answer = await api.knowledge.ask('What does DNA polymerase do?');
    expect(answer.markdown.length).toBeGreaterThan(0);
    // The demo lecture is about DNA replication, so there should be sources.
    expect(answer.noSources).toBe(false);
    expect(answer.citations.length).toBeGreaterThan(0);
  }, 30_000);

  it('finds transcript hits via keyword search', async () => {
    const hits = await api.transcripts.search('replication');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('generates a slide deck offline', async () => {
    const [course] = await api.courses.list();
    const [lecture] = await api.lectures.listByCourse(course!.id);
    const deck = await api.slides.generate(lecture!.id);
    expect(deck.slides.length).toBeGreaterThan(4);
    expect(deck.slides.every((s) => typeof s.speakerNotes === 'string')).toBe(true);
  }, 30_000);

  it('exposes provider descriptors including the offline mock', async () => {
    const providers = await api.providers.list();
    expect(providers.some((p) => p.id === 'mock')).toBe(true);
    expect(providers.some((p) => p.id === 'anthropic')).toBe(true);
  });

  it('tracks gamification state after activity', async () => {
    const state = await api.gamification.getState();
    expect(state.xp).toBeGreaterThan(0); // lecture-recorded fired during import
    const achievements = await api.gamification.getAchievements();
    expect(achievements.length).toBeGreaterThan(10);
  });

  it('builds a dashboard summary', async () => {
    const summary = await api.dashboard.getSummary();
    expect(summary.courses.length).toBeGreaterThan(0);
    expect(summary.recentLectures.length).toBeGreaterThan(0);
    expect(summary.recommendations.length).toBeGreaterThan(0);
  });

  it('reports idle recording status', async () => {
    const status = await api.recording.getStatus();
    expect(status.state).toBe('idle');
  });

  it('backs up and restores the knowledge base', async () => {
    const { filePath } = await api.system.backup();
    expect(filePath).toContain('studdybuddy-backup');
    await expect(api.system.restore(filePath)).resolves.toBeUndefined();
  }, 30_000);
});
