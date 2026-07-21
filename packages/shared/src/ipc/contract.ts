import type { AppError, Difficulty, JobProgress, Paginated } from '../types/common';
import type {
  Course,
  CourseInput,
  Lecture,
  RecordingStatus,
  Transcript,
  TranscriptSegment,
} from '../types/entities';
import type { Explanation, ExplanationStyle, LectureAnalysis } from '../types/analysis';
import type {
  Flashcard,
  MaterialType,
  QuizAttempt,
  StudyMaterial,
  StudyMaterialMeta,
} from '../types/materials';
import type { SlideDeck, SlideExportFormat, SlideExportResult } from '../types/slides';
import type { AskAnswer, ExamPrepPlan, SearchHit, SearchScope } from '../types/memory';
import type { AchievementDef, GamificationState, StudyEvent } from '../types/gamification';
import type { AppSettings, ProviderDescriptor } from '../types/settings';
import type { PluginInfo } from '../types/plugins';
import type { DashboardSummary } from '../types/dashboard';

/**
 * The complete typed API surface between renderer and main process.
 *
 * Channel names are derived as `<group>.<method>` (e.g. "courses.create").
 * The preload script exposes this interface as `window.studdybuddy.api`;
 * the main process implements it via the IPC router. Both sides share this
 * single source of truth, so a signature change is a compile error on both.
 */
export interface IpcApi {
  courses: {
    list(): Promise<Course[]>;
    get(id: string): Promise<Course | null>;
    create(input: CourseInput): Promise<Course>;
    update(id: string, patch: Partial<CourseInput> & { archived?: boolean }): Promise<Course>;
    remove(id: string): Promise<void>;
  };

  lectures: {
    listByCourse(courseId: string): Promise<Lecture[]>;
    listRecent(limit: number): Promise<(Lecture & { courseName: string; courseColor: string })[]>;
    get(id: string): Promise<Lecture | null>;
    update(id: string, patch: { title?: string; tags?: string[] }): Promise<Lecture>;
    remove(id: string): Promise<void>;
    /** Import a demo lecture (bundled sample) into the given course, end-to-end. */
    importDemo(courseId: string): Promise<Lecture>;
  };

  recording: {
    /** Begin a live recording session for a course; creates the Lecture row. */
    start(courseId: string, title?: string): Promise<{ lectureId: string }>;
    /** Push an audio chunk captured by the renderer (webm/opus bytes). */
    pushAudioChunk(chunk: ArrayBuffer, mimeType: string): Promise<void>;
    /**
     * Push a full transcript produced on the renderer side (on-device Whisper).
     * The list is authoritative and replaces any prior segments for the active
     * lecture — used by the local browser Whisper engine, which recognizes audio
     * in the renderer rather than the main process.
     */
    pushSegments(segments: TranscriptSegment[]): Promise<void>;
    /** Push a live level sample (0..1) for the meter + pause detection. */
    pushAudioLevel(level: number): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    /** Stop, finalize transcript, kick off analysis + study kit generation. */
    stop(): Promise<{ lectureId: string }>;
    getStatus(): Promise<RecordingStatus>;
  };

  transcripts: {
    get(lectureId: string): Promise<Transcript | null>;
    /** Plain-text keyword search across all transcripts. */
    search(query: string, scope?: SearchScope): Promise<SearchHit[]>;
  };

  analysis: {
    get(lectureId: string): Promise<LectureAnalysis | null>;
    /** (Re)run AI understanding over a lecture transcript. Progress via job events. */
    run(lectureId: string): Promise<{ jobId: string }>;
  };

  materials: {
    list(lectureId: string): Promise<StudyMaterialMeta[]>;
    get(materialId: string): Promise<StudyMaterial | null>;
    /** Generate one material type. Resolves when complete. */
    generate(
      lectureId: string,
      type: MaterialType,
      options?: { difficulty?: Difficulty },
    ): Promise<StudyMaterial>;
    /** Generate the full study kit (notes, summaries, flashcards, quiz…). */
    generateKit(lectureId: string, difficulty?: Difficulty): Promise<{ jobId: string }>;
    remove(materialId: string): Promise<void>;
  };

  flashcards: {
    /** All cards due for review, optionally scoped to a course. */
    due(courseId?: string): Promise<(Flashcard & { lectureId: string; materialId: string })[]>;
    /** Record a review result (SM-2 quality 0-5) and get updated scheduling. */
    review(materialId: string, cardId: string, quality: number): Promise<Flashcard>;
  };

  quizzes: {
    submitAttempt(
      attempt: Omit<QuizAttempt, 'id' | 'score' | 'missedConceptIds'>,
    ): Promise<QuizAttempt>;
    attemptsForLecture(lectureId: string): Promise<QuizAttempt[]>;
    /** AI-grade a short-answer response against the question's rubric. */
    gradeShortAnswer(input: {
      materialId: string;
      questionId: string;
      response: string;
    }): Promise<{ score: number; feedback: string }>;
  };

  explain: {
    /**
     * Explain a concept from a lecture. `attempt` > 1 (from "I still don't
     * understand") switches pedagogy style automatically.
     */
    concept(input: {
      lectureId: string;
      conceptName: string;
      attempt?: number;
      style?: ExplanationStyle;
    }): Promise<Explanation>;
  };

  slides: {
    get(lectureId: string): Promise<SlideDeck | null>;
    generate(lectureId: string): Promise<SlideDeck>;
    export(deckId: string, format: SlideExportFormat): Promise<SlideExportResult>;
  };

  knowledge: {
    /** Semantic search across the whole knowledge base. */
    search(query: string, scope?: SearchScope): Promise<SearchHit[]>;
    /** RAG Q&A: "What did my biology professor say about DNA replication?" */
    ask(question: string, scope?: SearchScope): Promise<AskAnswer>;
  };

  review: {
    examPrep(courseId: string): Promise<ExamPrepPlan>;
    latestExamPrep(courseId: string): Promise<ExamPrepPlan | null>;
  };

  gamification: {
    getState(): Promise<GamificationState>;
    getAchievements(): Promise<AchievementDef[]>;
    /** Record a study event from the renderer (e.g. game completed). */
    recordEvent(event: Omit<StudyEvent, 'at'>): Promise<GamificationState>;
  };

  dashboard: {
    getSummary(): Promise<DashboardSummary>;
  };

  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
  };

  providers: {
    list(): Promise<ProviderDescriptor[]>;
    setApiKey(providerId: string, apiKey: string): Promise<void>;
    clearApiKey(providerId: string): Promise<void>;
    /** Round-trip test of the provider with current credentials. */
    test(providerId: string): Promise<{ ok: boolean; message: string }>;
  };

  plugins: {
    list(): Promise<PluginInfo[]>;
    setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  };

  system: {
    /** App/data paths for display in Settings. */
    getInfo(): Promise<{ version: string; dataDir: string; platform: string }>;
    /** Export the entire local knowledge base to a backup file. */
    backup(): Promise<{ filePath: string }>;
    /** Restore from a backup file created by `backup()`. */
    restore(filePath: string): Promise<void>;
    /** Open a path or URL with the OS default handler. */
    openPath(path: string): Promise<void>;
    /** Recent log lines for the diagnostics panel. */
    getLogs(limit?: number): Promise<string[]>;
  };
}

/** Push events streamed from main to renderer. */
export interface IpcEventMap {
  /** Live recording status ticks (~2/s while recording). */
  'recording:status': RecordingStatus;
  /**
   * New or updated transcript segments during live transcription. When
   * `replace` is true the list is authoritative and supersedes everything shown
   * so far (Whisper engines re-transcribe the whole clip); otherwise segments
   * are appended.
   */
  'transcript:segments': { lectureId: string; segments: TranscriptSegment[]; replace?: boolean };
  /** Structure updates (paragraphs/sections/topics) during or after recording. */
  'transcript:updated': { lectureId: string };
  /** Long-running job progress (analysis, study kit, exports). */
  'job:progress': JobProgress;
  /** A lecture finished the full pipeline and is ready to study. */
  'lecture:ready': { lectureId: string };
  /** Achievement unlocked — the UI shows a celebration toast. */
  'achievement:unlocked': { achievementId: string; name: string; icon: string; xp: number };
  /** Gamification state changed (xp/streak) — refresh header widgets. */
  'gamification:updated': GamificationState;
  /** Non-fatal errors surfaced as toasts. */
  'app:error': AppError;
}

export type IpcGroup = keyof IpcApi;

/** Flattened channel names: "courses.create", "recording.start", … */
export type IpcChannel = {
  [G in IpcGroup]: `${G & string}.${keyof IpcApi[G] & string}`;
}[IpcGroup];

export const IPC_INVOKE_PREFIX = 'sb:invoke:';
export const IPC_EVENT_PREFIX = 'sb:event:';

/**
 * Runtime list of API groups/methods, used by the preload script to build the
 * bridge object without importing implementation code. Must mirror IpcApi.
 */
export const IPC_SURFACE: Record<IpcGroup, string[]> = {
  courses: ['list', 'get', 'create', 'update', 'remove'],
  lectures: ['listByCourse', 'listRecent', 'get', 'update', 'remove', 'importDemo'],
  recording: [
    'start',
    'pushAudioChunk',
    'pushSegments',
    'pushAudioLevel',
    'pause',
    'resume',
    'stop',
    'getStatus',
  ],
  transcripts: ['get', 'search'],
  analysis: ['get', 'run'],
  materials: ['list', 'get', 'generate', 'generateKit', 'remove'],
  flashcards: ['due', 'review'],
  quizzes: ['submitAttempt', 'attemptsForLecture', 'gradeShortAnswer'],
  explain: ['concept'],
  slides: ['get', 'generate', 'export'],
  knowledge: ['search', 'ask'],
  review: ['examPrep', 'latestExamPrep'],
  gamification: ['getState', 'getAchievements', 'recordEvent'],
  dashboard: ['getSummary'],
  settings: ['get', 'update'],
  providers: ['list', 'setApiKey', 'clearApiKey', 'test'],
  plugins: ['list', 'setEnabled'],
  system: ['getInfo', 'backup', 'restore', 'openPath', 'getLogs'],
};

export type { Paginated };
