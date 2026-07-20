import type { EmbeddingProvider } from '../types';

/** Output dimensionality; small enough to store per-chunk, large enough to keep hash collisions rare. */
const DIMENSIONS = 384;

/** Down-weight bigrams so shared vocabulary dominates but word order still contributes. */
const BIGRAM_WEIGHT = 0.6;

/**
 * Function words carry no topical signal but appear in almost every sentence;
 * hashing them would give unrelated sentences a large shared component and
 * flatten the similar-vs-unrelated cosine gap that the memory layer relies on.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'as', 'at', 'by', 'for', 'from',
  'in', 'into', 'of', 'on', 'to', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'am', 'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should',
  'it', 'its', 'itself', 'this', 'that', 'these', 'those', 'which', 'who', 'whom', 'what',
  'we', 'you', 'they', 'he', 'she', 'i', 'their', 'his', 'her', 'our', 'your', 'my', 'not',
  'each', 'every', 'all', 'any', 'some', 'no', 'there', 'here', 'when', 'where', 'how', 'than',
]);

/** 32-bit FNV-1a hash — tiny, fast, deterministic across platforms. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Lowercase, strip punctuation/diacritics, split on whitespace, drop stopwords. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

/**
 * Deterministic offline embeddings via the hashing trick — the guarantee that
 * the RAG memory layer works with zero API keys.
 *
 * Each content token (and each bigram of adjacent content tokens) is hashed
 * with FNV-1a into two of 384 buckets (two independent salts, so a single
 * unlucky collision cannot erase a term), accumulating term frequency. The
 * vector is then L2-normalized so cosine similarity is a dot product.
 * Sentences sharing vocabulary/phrases land in the same buckets and score
 * visibly higher than unrelated ones.
 */
export class LocalHashEmbedding implements EmbeddingProvider {
  readonly id = 'local-hash';
  readonly name = 'Local hashing (offline)';
  readonly dimensions = DIMENSIONS;

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    const tokens = tokenize(text);

    const addTerm = (term: string, weight: number): void => {
      vector[fnv1a(term) % DIMENSIONS]! += weight;
      vector[fnv1a(`\u0001${term}`) % DIMENSIONS]! += weight;
    };

    for (const token of tokens) addTerm(token, 1);
    for (let i = 0; i < tokens.length - 1; i++) {
      addTerm(`${tokens[i]}_${tokens[i + 1]}`, BIGRAM_WEIGHT);
    }

    let sumSquares = 0;
    for (const value of vector) sumSquares += value * value;
    if (sumSquares === 0) return vector;
    const norm = Math.sqrt(sumSquares);
    for (let i = 0; i < vector.length; i++) vector[i]! /= norm;
    return vector;
  }
}
