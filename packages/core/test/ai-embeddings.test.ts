import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/infra/logger';
import { LocalHashEmbedding } from '../src/ai/embeddings/local-hash';
import { OpenAIEmbedding } from '../src/ai/embeddings/openai';
import { OllamaEmbedding } from '../src/ai/embeddings/ollama';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe('LocalHashEmbedding', () => {
  const provider = new LocalHashEmbedding();

  it('is always configured, 384-dimensional, and deterministic', async () => {
    expect(provider.id).toBe('local-hash');
    expect(provider.dimensions).toBe(384);
    expect(await provider.isConfigured()).toBe(true);

    const [first] = await provider.embed(['DNA replication is the process of copying DNA.']);
    const [second] = await provider.embed(['DNA replication is the process of copying DNA.']);
    expect(first).toHaveLength(384);
    expect(first).toEqual(second);

    // Unit norm (cosine becomes a plain dot product downstream).
    const norm = Math.sqrt(first!.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('scores similar sentences visibly higher than unrelated ones', async () => {
    const [replication, copies, revolution] = await provider.embed([
      'dna replication is the process by which a cell copies its dna before division',
      'dna copies itself so that each new cell receives the same genetic information',
      'the french revolution began in 1789 with the storming of the bastille prison',
    ]);
    const similar = cosine(replication!, copies!);
    const unrelated = cosine(replication!, revolution!);

    expect(similar).toBeGreaterThan(unrelated + 0.15);
    expect(similar).toBeGreaterThan(2 * Math.max(unrelated, 0.01));
  });

  it('returns a zero vector for empty/stopword-only text instead of failing', async () => {
    const [empty, stops] = await provider.embed(['', 'the of and is']);
    expect(empty).toHaveLength(384);
    expect(empty!.every((v) => v === 0)).toBe(true);
    expect(stops!.every((v) => v === 0)).toBe(true);
  });
});

describe('remote embedding providers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('OpenAIEmbedding posts to /v1/embeddings and returns vectors in input order', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAIEmbedding({
      getApiKey: async () => 'sk-test',
      getSettings: () => ({}),
      logger: noopLogger,
    });
    expect(provider.dimensions).toBe(1536);

    const vectors = await provider.embed(['first', 'second']);
    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'text-embedding-3-small',
      input: ['first', 'second'],
    });
  });

  it('OpenAIEmbedding is unconfigured without a key', async () => {
    const provider = new OpenAIEmbedding({
      getApiKey: async () => null,
      getSettings: () => ({}),
      logger: noopLogger,
    });
    expect(await provider.isConfigured()).toBe(false);
  });

  it('OllamaEmbedding posts to /api/embed with nomic-embed-text', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ embeddings: [[0.5, 0.5]] }), { status: 200 }),
    );
    const provider = new OllamaEmbedding({
      getApiKey: async () => null,
      getSettings: () => ({ baseUrl: 'http://box:11434' }),
      logger: noopLogger,
    });
    expect(provider.dimensions).toBe(768);

    const vectors = await provider.embed(['hello']);
    expect(vectors).toEqual([[0.5, 0.5]]);

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('http://box:11434/api/embed');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'nomic-embed-text',
      input: ['hello'],
    });
  });

  it('embeds nothing without a network call for empty input', async () => {
    const provider = new OllamaEmbedding({
      getApiKey: async () => null,
      getSettings: () => ({}),
      logger: noopLogger,
    });
    expect(await provider.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
