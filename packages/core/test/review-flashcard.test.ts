import { describe, expect, it } from 'vitest';
import type {
  Course,
  Flashcard,
  StudyEvent,
  StudyMaterial,
} from '@studdybuddy/shared';
import { LogManager } from '../src/infra/logger';
import type { Repositories } from '../src/storage/types';
import { FlashcardReviewService } from '../src/review/flashcard-review-service';

const logger = new LogManager().getLogger('test');
const T0 = 1_700_000_000_000;

/* ————————————————————————— in-memory repositories ————————————————————————— */

interface Backing {
  courses: Map<string, Course>;
  materials: Map<string, StudyMaterial>;
}

function makeRepos(): { repos: Repositories; backing: Backing } {
  const backing: Backing = { courses: new Map(), materials: new Map() };
  const repos = {
    courses: {
      list: async () =>
        [...backing.courses.values()].sort((a, b) => a.name.localeCompare(b.name)),
      get: async (id: string) => backing.courses.get(id) ?? null,
    },
    materials: {
      get: async (id: string) => backing.materials.get(id) ?? null,
      put: async (m: StudyMaterial) => {
        backing.materials.set(m.id, m);
      },
      byCourseAndType: async (courseId: string, type: string) =>
        [...backing.materials.values()]
          .filter((m) => m.courseId === courseId && m.type === type)
          .sort((a, b) => a.createdAt - b.createdAt),
    },
  };
  return { repos: repos as unknown as Repositories, backing };
}

/* ————————————————————————— fixtures ————————————————————————— */

function course(id: string, name: string): Course {
  return {
    id,
    name,
    instructor: 'Prof',
    semester: 'Fall 2026',
    color: '#7c3aed',
    icon: 'dna',
    archived: false,
    createdAt: T0,
    updatedAt: T0,
  };
}

function card(id: string, dueAt: number): Flashcard {
  return {
    id,
    front: `Front ${id}`,
    back: `Back ${id}`,
    srs: { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueAt },
  };
}

function deck(
  id: string,
  courseId: string,
  lectureId: string,
  cards: Flashcard[],
): StudyMaterial<'flashcards'> {
  return {
    id,
    lectureId,
    courseId,
    type: 'flashcards',
    title: 'Deck',
    difficulty: 'medium',
    content: { cards },
    generatedBy: 'heuristic',
    createdAt: T0,
  };
}

describe('FlashcardReviewService', () => {
  it('surfaces only due cards, oldest-due first, tagged with material/lecture/course', async () => {
    const { repos, backing } = makeRepos();
    backing.courses.set('c1', course('c1', 'Biology'));
    const now = Date.now();
    backing.materials.set(
      'm1',
      deck('m1', 'c1', 'l1', [
        card('a', now - 1_000), // due
        card('b', now + 3_600_000), // not yet due
        card('c', now - 60_000), // due, oldest
      ]),
    );

    const svc = new FlashcardReviewService({ repos, logger });
    const due = await svc.dueCards('c1');

    expect(due.map((d) => d.id)).toEqual(['c', 'a']);
    expect(due[0]!.materialId).toBe('m1');
    expect(due[0]!.lectureId).toBe('l1');
    expect(due[0]!.courseId).toBe('c1');
  });

  it('scans every course when no course id is given', async () => {
    const { repos, backing } = makeRepos();
    backing.courses.set('c1', course('c1', 'Biology'));
    backing.courses.set('c2', course('c2', 'Chemistry'));
    const now = Date.now();
    backing.materials.set('m1', deck('m1', 'c1', 'l1', [card('a', now - 1_000)]));
    backing.materials.set('m2', deck('m2', 'c2', 'l2', [card('b', now - 2_000)]));

    const svc = new FlashcardReviewService({ repos, logger });
    const due = await svc.dueCards();
    expect(due.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('grades a card via SM-2 and persists the new SRS state', async () => {
    const { repos, backing } = makeRepos();
    backing.courses.set('c1', course('c1', 'Biology'));
    const now = Date.now();
    backing.materials.set('m1', deck('m1', 'c1', 'l1', [card('a', now - 1_000)]));

    const svc = new FlashcardReviewService({ repos, logger });
    const updated = await svc.reviewCard('m1', 'a', 5);

    expect(updated.srs.reps).toBe(1);
    expect(updated.srs.intervalDays).toBe(1);
    expect(updated.srs.dueAt).toBeGreaterThan(now);

    // The change must be durable: reload the material and re-read the card.
    const reloaded = await repos.materials.get('m1');
    const persisted = (reloaded!.content as { cards: Flashcard[] }).cards.find((c) => c.id === 'a');
    expect(persisted!.srs.reps).toBe(1);
    expect(persisted!.srs.dueAt).toBe(updated.srs.dueAt);
  });

  it('records a flashcard-reviewed study event when a recorder is wired', async () => {
    const { repos, backing } = makeRepos();
    backing.courses.set('c1', course('c1', 'Biology'));
    const now = Date.now();
    backing.materials.set('m1', deck('m1', 'c1', 'l1', [card('a', now - 1_000)]));

    const events: StudyEvent[] = [];
    const svc = new FlashcardReviewService({
      repos,
      logger,
      gamification: {
        record: async (e) => {
          events.push(e);
        },
      },
    });
    await svc.reviewCard('m1', 'a', 4);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('flashcard-reviewed');
    expect(events[0]!.minutes).toBe(0.4);
    expect(events[0]!.courseId).toBe('c1');
    expect(events[0]!.data).toMatchObject({ materialId: 'm1', cardId: 'a', quality: 4 });
  });

  it('counts due cards per course for the dashboard', async () => {
    const { repos, backing } = makeRepos();
    backing.courses.set('c1', course('c1', 'Biology'));
    backing.courses.set('c2', course('c2', 'Chemistry'));
    const now = Date.now();
    backing.materials.set(
      'm1',
      deck('m1', 'c1', 'l1', [card('a', now - 1_000), card('b', now - 2_000), card('f', now + 1e7)]),
    );
    backing.materials.set('m2', deck('m2', 'c2', 'l2', [card('c', now - 1_000)]));

    const svc = new FlashcardReviewService({ repos, logger });
    const counts = await svc.dueCountByCourse();
    expect(counts.get('c1')).toBe(2);
    expect(counts.get('c2')).toBe(1);
  });

  it('rejects unknown materials, unknown cards, and non-flashcard materials', async () => {
    const { repos, backing } = makeRepos();
    backing.courses.set('c1', course('c1', 'Biology'));
    backing.materials.set('m1', deck('m1', 'c1', 'l1', [card('a', T0)]));
    // A non-flashcards material sharing the repo.
    backing.materials.set('notes1', {
      id: 'notes1',
      lectureId: 'l1',
      courseId: 'c1',
      type: 'summary-concise',
      title: 'Summary',
      difficulty: 'medium',
      content: { markdown: 'hi' },
      generatedBy: 'heuristic',
      createdAt: T0,
    } as StudyMaterial);

    const svc = new FlashcardReviewService({ repos, logger });
    await expect(svc.reviewCard('missing', 'a', 5)).rejects.toThrow(/not found/i);
    await expect(svc.reviewCard('m1', 'missing', 5)).rejects.toThrow(/not found/i);
    await expect(svc.reviewCard('notes1', 'a', 5)).rejects.toThrow(/flashcards/i);
  });
});
