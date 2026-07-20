import { describe, expect, it, vi } from 'vitest';
import { api, onEvent, triggerMockEvent } from './api';

describe('mock api', () => {
  it('lists two seeded courses', async () => {
    const courses = await api.courses.list();
    expect(courses.map((c) => c.name)).toContain('Biology');
    expect(courses.length).toBeGreaterThanOrEqual(2);
  });

  it('returns a lecture analysis with concepts', async () => {
    const analysis = await api.analysis.get('lec-bio-1');
    expect(analysis).not.toBeNull();
    expect(analysis!.concepts.length).toBeGreaterThan(0);
  });

  it('generates a study material for a lecture', async () => {
    const mat = await api.materials.generate('lec-bio-1', 'summary-concise');
    expect(mat.type).toBe('summary-concise');
    expect(mat.lectureId).toBe('lec-bio-1');
  });

  it('answers knowledge questions with citations', async () => {
    const answer = await api.knowledge.ask('replication');
    expect(answer.markdown.length).toBeGreaterThan(0);
    expect(answer.noSources).toBe(false);
  });

  it('reports no sources for an unrelated question', async () => {
    const answer = await api.knowledge.ask('zzznonexistenttopic');
    expect(answer.noSources).toBe(true);
  });
});

describe('event system', () => {
  it('delivers events to subscribers and stops after unsubscribe', () => {
    const handler = vi.fn();
    const off = onEvent('gamification:updated', handler);
    triggerMockEvent('gamification:updated', {
      xp: 10,
      level: 1,
      streak: { current: 1, best: 1, lastStudyDay: '2026-07-20' },
      unlocked: [],
      studyMinutes: 0,
      dailyMinutes: {},
      updatedAt: Date.now(),
    });
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    triggerMockEvent('gamification:updated', {
      xp: 20,
      level: 1,
      streak: { current: 1, best: 1, lastStudyDay: '2026-07-20' },
      unlocked: [],
      studyMinutes: 0,
      dailyMinutes: {},
      updatedAt: Date.now(),
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
