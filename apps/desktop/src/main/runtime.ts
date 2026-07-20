import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  newId,
  type AppSettings,
  type Course,
  type CourseInput,
  type DashboardSummary,
  type IpcApi,
  type Lecture,
  type ProviderDescriptor,
  type StudyEvent,
} from '@studdybuddy/shared';
import {
  AIProviderRegistry,
  BackupService,
  createAIFacade,
  createAnalysisService,
  createExamPrepService,
  createExplainService,
  createFlashcardReviewService,
  createGamificationService,
  createLectureAnalyzer,
  createMaterialsService,
  createQuizService,
  createSlidesService,
  createStorageAdapter,
  createExportService,
  createRepositories,
  EmbeddingRegistry,
  EventBus,
  importDemoLecture,
  KnowledgeIndexer,
  KnowledgeService,
  LocalVectorStore,
  PluginRegistry,
  RecordingService,
  registerBuiltinAI,
  registerBuiltinExporters,
  registerBuiltinGenerators,
  registerBuiltinTranscription,
  SbError,
  ErrorCodes,
  SecretsVault,
  SettingsService,
  TranscriptionRegistry,
  apiKeyName,
  type CoreEnv,
  type CoreEventBus,
  type EmbeddingProvider,
  type Logger,
} from '@studdybuddy/core';

/**
 * Everything the desktop app needs from the core runtime, assembled in one
 * place. This module imports **no Electron APIs** so the whole runtime — and
 * the end-to-end lecture pipeline — can be constructed and tested under plain
 * Node (see runtime.test.ts). `bootstrap.ts` supplies the Electron-specific
 * `CoreEnv` and `openPath`.
 */
export interface RuntimeOptions {
  env: CoreEnv;
  /** Opens a path/URL with the OS handler (Electron `shell`); no-op in tests. */
  openPath?: (target: string) => Promise<void>;
}

export interface Runtime {
  api: IpcApi;
  bus: CoreEventBus;
  dispose(): Promise<void>;
}

const DAY_MS = 86_400_000;

export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const { env } = options;
  const { dataDir, appVersion } = env;
  const logger: Logger = env.logManager.getLogger('runtime');
  await fs.mkdir(dataDir, { recursive: true });

  // ——— Settings, secrets, plugins ———
  const settings = new SettingsService(dataDir, logger);
  await settings.init();
  const vault = new SecretsVault(dataDir, logger, env.secretsCrypto);
  const pluginRegistry = new PluginRegistry(logger);

  // Built-in plugins must register their contributions before any registry
  // reads them (the registries pull providers from the plugin registry).
  registerBuiltinAI(pluginRegistry, { vault, settings, logger });
  registerBuiltinTranscription(pluginRegistry, { vault, settings, logger });
  registerBuiltinGenerators(pluginRegistry);
  registerBuiltinExporters(pluginRegistry);

  // Restore persisted plugin enable/disable state.
  const storage = await createStorageAdapter(dataDir, logger);
  const repos = createRepositories(storage.adapter);
  const pluginState = await repos.kv.get<Record<string, boolean>>('plugins:enabled');
  if (pluginState) pluginRegistry.restoreSnapshot(pluginState);

  // ——— AI + embeddings ———
  const aiRegistry = new AIProviderRegistry({ pluginRegistry, settings, vault, logger });
  const embeddingRegistry = new EmbeddingRegistry({ pluginRegistry, settings, vault, logger });
  const ai = createAIFacade({ registry: aiRegistry, logger });

  // The indexer/knowledge layer wants a *synchronous* embedder accessor, but
  // the active provider can change at runtime. Cache it and refresh whenever
  // settings change (the local-hash provider is always a safe fallback).
  let currentEmbedder: EmbeddingProvider = await embeddingRegistry.getActive();
  const getEmbedder = (): EmbeddingProvider => currentEmbedder;
  const refreshEmbedder = async (): Promise<void> => {
    try {
      currentEmbedder = await embeddingRegistry.getActive();
    } catch (e) {
      logger.warn('failed to refresh embedder; keeping previous', {
        error: (e as Error).message,
      });
    }
  };

  // ——— Storage-derived services ———
  const bus: CoreEventBus = new EventBus();
  const backup = new BackupService(
    storage.adapter,
    path.join(dataDir, 'settings.json'),
    appVersion,
    logger,
  );
  const transcriptionRegistry = new TranscriptionRegistry({
    pluginRegistry,
    settings,
    vault,
    logger,
  });

  const vectorStore = new LocalVectorStore({ repos, logger });
  const indexer = new KnowledgeIndexer({ repos, getEmbedder, store: vectorStore, logger });
  const knowledge = new KnowledgeService({ repos, getEmbedder, store: vectorStore, ai, logger });

  const analyzer = createLectureAnalyzer({ ai, logger });
  const analysisService = createAnalysisService({ repos, analyzer, bus, logger });
  const materialsService = createMaterialsService({ repos, ai, pluginRegistry, bus, logger });
  const quizService = createQuizService({ repos, ai, logger });
  const gamification = createGamificationService({ repos, bus, logger });
  const flashcardReview = createFlashcardReviewService({ repos, bus, gamification, logger });
  const examPrep = createExamPrepService({ repos, ai, bus, logger });
  const slides = createSlidesService({ repos, ai, bus, logger });
  const exportService = createExportService({ pluginRegistry, repos, dataDir, logger });
  const explain = createExplainService({ repos, ai, logger });

  /**
   * The post-recording pipeline: understand the lecture, index it for search,
   * and kick off study-material generation, then mark it ready. Wired into the
   * recording service (runs when a recording stops) and reused by demo import.
   */
  async function finalizeLecture(lectureId: string): Promise<void> {
    const started = Date.now();
    try {
      await analysisService.run(lectureId);
      await indexer.indexLecture(lectureId);
      const prefs = settings.get();
      if (prefs.autoGenerateStudyKit) {
        // Fire-and-forget: emits its own job:progress; notes get indexed on the
        // next re-index. The lecture is usable as soon as analysis is done.
        await materialsService.generateKit(lectureId, prefs.defaultDifficulty);
      }
      const lecture = await repos.lectures.get(lectureId);
      if (lecture) {
        lecture.status = 'ready';
        lecture.updatedAt = Date.now();
        await repos.lectures.put(lecture);
        await gamification.record({
          type: 'lecture-recorded',
          at: Date.now(),
          courseId: lecture.courseId,
          lectureId,
          minutes: Math.max(1, Math.round(lecture.durationMs / 60_000)),
        });
      }
      bus.emit('lecture:ready', { lectureId });
      logger.info('lecture finalized', { lectureId, ms: Date.now() - started });
    } catch (e) {
      logger.error('lecture finalize failed', { lectureId, error: (e as Error).message });
      const lecture = await repos.lectures.get(lectureId);
      if (lecture && lecture.status !== 'failed') {
        lecture.status = 'failed';
        lecture.updatedAt = Date.now();
        await repos.lectures.put(lecture);
      }
      throw e;
    }
  }

  const recording = new RecordingService({
    repos,
    registry: transcriptionRegistry,
    settings,
    bus,
    logger,
    dataDir,
    ai,
    onLectureFinalized: finalizeLecture,
  });

  // Keep the embedder in sync with the user's provider choice.
  const unsubscribeSettings = settings.onChange(() => {
    void refreshEmbedder();
  });

  // ——— Helpers ———

  const courseView = (c: Course) => ({ courseName: c.name, courseColor: c.color });

  async function hydrateLecture(lecture: Lecture) {
    const course = await repos.courses.get(lecture.courseId);
    return { ...lecture, ...courseView(course ?? fallbackCourse(lecture.courseId)) };
  }

  function fallbackCourse(id: string): Course {
    const now = Date.now();
    return {
      id,
      name: 'Unknown course',
      instructor: '',
      semester: '',
      color: '#7c6cf6',
      icon: 'book-open',
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  async function buildDashboard(): Promise<DashboardSummary> {
    const [courses, recent, gState, dueByCourse] = await Promise.all([
      repos.courses.list(),
      repos.lectures.recent(8),
      gamification.getState(),
      flashcardReview.dueCountByCourse(),
    ]);
    const activeCourses = courses.filter((c) => !c.archived);
    const courseById = new Map(courses.map((c) => [c.id, c]));

    const recentLectures = recent.map((l) => ({
      ...l,
      ...courseView(courseById.get(l.courseId) ?? fallbackCourse(l.courseId)),
    }));

    const dueReviews = [...dueByCourse.entries()]
      .filter(([, count]) => count > 0)
      .map(([courseId, dueCards]) => ({
        courseId,
        courseName: courseById.get(courseId)?.name ?? 'Course',
        dueCards,
      }));

    const now = Date.now();
    const upcomingExams = activeCourses
      .flatMap((c) => (c.examDates ?? []).map((date) => ({ courseId: c.id, courseName: c.name, date })))
      .filter((e) => e.date >= now && e.date <= now + 30 * DAY_MS)
      .sort((a, b) => a.date - b.date);

    const todayKey = new Date().toISOString().slice(0, 10);
    const studyMinutesToday = Math.round(gState.dailyMinutes[todayKey] ?? 0);
    const studyMinutesWeek = Math.round(
      Object.entries(gState.dailyMinutes)
        .filter(([day]) => (now - Date.parse(day)) / DAY_MS < 7)
        .reduce((sum, [, m]) => sum + m, 0),
    );

    return {
      courses: activeCourses,
      recentLectures,
      dueReviews,
      upcomingExams,
      studyStreak: gState.streak.current,
      xp: gState.xp,
      level: gState.level,
      studyMinutesToday,
      studyMinutesWeek,
      recommendations: buildRecommendations(recentLectures, dueReviews, upcomingExams),
    };
  }

  function buildRecommendations(
    recentLectures: (Lecture & { courseName: string })[],
    dueReviews: { courseId: string; courseName: string; dueCards: number }[],
    upcomingExams: { courseId: string; courseName: string; date: number }[],
  ): DashboardSummary['recommendations'] {
    const recs: DashboardSummary['recommendations'] = [];
    const soonExam = upcomingExams[0];
    if (soonExam) {
      recs.push({
        title: `Prep for your ${soonExam.courseName} exam`,
        detail: 'Generate a cumulative review and target your weak areas.',
        courseId: soonExam.courseId,
      });
    }
    const topDue = dueReviews.sort((a, b) => b.dueCards - a.dueCards)[0];
    if (topDue) {
      recs.push({
        title: `Review ${topDue.dueCards} due card${topDue.dueCards === 1 ? '' : 's'}`,
        detail: `Keep your ${topDue.courseName} streak alive with a quick session.`,
        courseId: topDue.courseId,
      });
    }
    const ready = recentLectures.find((l) => l.status === 'ready');
    if (ready) {
      recs.push({
        title: `Study "${ready.title}"`,
        detail: 'Open the interactive activities to lock in the key concepts.',
        courseId: ready.courseId,
        lectureId: ready.id,
      });
    }
    if (recs.length === 0) {
      recs.push({
        title: 'Record your first lecture',
        detail: 'Or import the demo lecture from any class to see StuddyBuddy in action.',
      });
    }
    return recs;
  }

  async function combinedProviderDescriptors(): Promise<ProviderDescriptor[]> {
    const [aiD, txD, embD] = await Promise.all([
      aiRegistry.descriptors(),
      transcriptionRegistry.descriptors(),
      embeddingRegistry.descriptors(),
    ]);
    return [...aiD, ...txD, ...embD];
  }

  async function persistPluginState(): Promise<void> {
    await repos.kv.put('plugins:enabled', pluginRegistry.snapshot());
  }

  // ——— The IPC API implementation (mirrors the shared contract exactly) ———
  const api: IpcApi = {
    courses: {
      list: () => repos.courses.list(),
      get: (id) => repos.courses.get(id),
      create: async (input: CourseInput) => {
        const now = Date.now();
        const course: Course = {
          id: newId(),
          name: input.name,
          instructor: input.instructor,
          semester: input.semester,
          color: input.color,
          icon: input.icon,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.examDates !== undefined ? { examDates: input.examDates } : {}),
          archived: false,
          createdAt: now,
          updatedAt: now,
        };
        await repos.courses.put(course);
        return course;
      },
      update: async (id, patch) => {
        const course = await repos.courses.get(id);
        if (!course) throw new SbError(ErrorCodes.NOT_FOUND, `Course "${id}" not found.`);
        const updated: Course = { ...course, ...patch, id, updatedAt: Date.now() };
        await repos.courses.put(updated);
        return updated;
      },
      remove: (id) => repos.deleteCourseCascade(id),
    },

    lectures: {
      listByCourse: (courseId) => repos.lectures.byCourse(courseId),
      listRecent: async (limit) => {
        const recent = await repos.lectures.recent(limit);
        return Promise.all(recent.map(hydrateLecture));
      },
      get: (id) => repos.lectures.get(id),
      update: async (id, patch) => {
        const lecture = await repos.lectures.get(id);
        if (!lecture) throw new SbError(ErrorCodes.NOT_FOUND, `Lecture "${id}" not found.`);
        const updated: Lecture = {
          ...lecture,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
          updatedAt: Date.now(),
        };
        await repos.lectures.put(updated);
        return updated;
      },
      remove: async (id) => {
        const lecture = await repos.lectures.get(id);
        await vectorStore.removeByLecture(id);
        await repos.deleteLectureCascade(id);
        if (lecture?.audioPath) {
          await fs.rm(path.join(dataDir, lecture.audioPath), { force: true }).catch(() => {});
        }
      },
      importDemo: async (courseId) => {
        const lecture = await importDemoLecture({ repos, courseId, bus });
        await finalizeLecture(lecture.id).catch((e) =>
          logger.error('demo finalize failed', { error: (e as Error).message }),
        );
        return (await repos.lectures.get(lecture.id)) ?? lecture;
      },
    },

    recording: {
      start: (courseId, title) => recording.start(courseId, title),
      pushAudioChunk: (chunk, mimeType) =>
        recording.pushAudioChunk(new Uint8Array(chunk), mimeType),
      pushAudioLevel: async (level) => recording.pushAudioLevel(level),
      pause: async () => recording.pause(),
      resume: async () => recording.resume(),
      stop: () => recording.stop(),
      getStatus: async () => recording.getStatus(),
    },

    transcripts: {
      get: (lectureId) => repos.transcripts.getByLecture(lectureId),
      search: (query, scope) => knowledge.keywordSearch(query, scope),
    },

    analysis: {
      get: (lectureId) => analysisService.get(lectureId),
      run: async (lectureId) => {
        // Thread one job id through both the emitted progress events and the
        // returned value so the renderer can track this job to completion.
        const jobId = newId();
        void analysisService
          .run(lectureId, jobId)
          .catch((e) => logger.error('analysis run failed', { error: (e as Error).message }));
        return { jobId };
      },
    },

    materials: {
      list: (lectureId) => materialsService.list(lectureId),
      get: (materialId) => materialsService.get(materialId),
      generate: (lectureId, type, opts) =>
        materialsService.generate(lectureId, type, opts ?? {}),
      generateKit: (lectureId, difficulty) => materialsService.generateKit(lectureId, difficulty),
      remove: (materialId) => materialsService.remove(materialId),
    },

    flashcards: {
      due: (courseId) => flashcardReview.dueCards(courseId),
      review: (materialId, cardId, quality) =>
        flashcardReview.reviewCard(materialId, cardId, quality as 0 | 1 | 2 | 3 | 4 | 5),
    },

    quizzes: {
      submitAttempt: (attempt) => quizService.submitAttempt(attempt),
      attemptsForLecture: (lectureId) => quizService.attemptsForLecture(lectureId),
      gradeShortAnswer: ({ materialId, questionId, response }) =>
        quizService.gradeShortAnswer(materialId, questionId, response),
    },

    explain: {
      concept: (input) => explain.concept(input),
    },

    slides: {
      get: (lectureId) => slides.get(lectureId),
      generate: (lectureId) => slides.generate(lectureId),
      export: (deckId, format) => exportService.export(deckId, format),
    },

    knowledge: {
      search: (query, scope) => knowledge.semanticSearch(query, scope),
      ask: (question, scope) => knowledge.ask(question, scope),
    },

    review: {
      examPrep: (courseId) => examPrep.generate(courseId),
      latestExamPrep: (courseId) => examPrep.latest(courseId),
    },

    gamification: {
      getState: () => gamification.getState(),
      getAchievements: async () => [...gamification.catalog()],
      recordEvent: (event) => gamification.record({ ...event, at: Date.now() } as StudyEvent),
    },

    dashboard: {
      getSummary: () => buildDashboard(),
    },

    settings: {
      get: async () => settings.get(),
      update: (patch: Partial<AppSettings>) => settings.update(patch),
    },

    providers: {
      list: () => combinedProviderDescriptors(),
      setApiKey: (providerId, apiKey) => vault.setSecret(apiKeyName(providerId), apiKey),
      clearApiKey: (providerId) => vault.deleteSecret(apiKeyName(providerId)),
      test: async (providerId) => {
        try {
          return await aiRegistry.test(providerId);
        } catch {
          const all = await combinedProviderDescriptors();
          const d = all.find((p) => p.id === providerId);
          if (!d) return { ok: false, message: `Unknown provider "${providerId}".` };
          return d.available
            ? { ok: true, message: `${d.name} is ready.` }
            : { ok: false, message: `${d.name} is not configured yet.` };
        }
      },
    },

    plugins: {
      list: async () => pluginRegistry.list(),
      setEnabled: async (pluginId, enabled) => {
        pluginRegistry.setEnabled(pluginId, enabled);
        await persistPluginState();
      },
    },

    system: {
      getInfo: async () => ({ version: appVersion, dataDir, platform: process.platform }),
      backup: async () => {
        const dir = path.join(dataDir, 'backups');
        await fs.mkdir(dir, { recursive: true });
        const filePath = await backup.backup(dir);
        return { filePath };
      },
      restore: async (filePath) => {
        await backup.restore(filePath);
        await settings.init();
        await vectorStore.removeByLecture('__noop__').catch(() => {});
        await refreshEmbedder();
      },
      openPath: async (target) => {
        await options.openPath?.(target);
      },
      getLogs: async (limit) =>
        env.logManager.recent(limit ?? 400).map((r) => {
          const time = new Date(r.at).toISOString();
          return `${time} [${r.level.toUpperCase()}] ${r.scope}: ${r.message}`;
        }),
    },
  };

  return {
    api,
    bus,
    dispose: async () => {
      unsubscribeSettings();
      bus.clear();
      await storage.adapter.close();
    },
  };
}
