/** Truncate to `max` characters on a word boundary, appending an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/** Split text into ~`targetChars` chunks on sentence boundaries with overlap. */
export function chunkText(
  text: string,
  targetChars = 1200,
  overlapChars = 150,
): { text: string; start: number }[] {
  const chunks: { text: string; start: number }[] = [];
  if (!text.trim()) return chunks;
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) ?? [text];
  let current = '';
  let currentStart = 0;
  let cursor = 0;
  for (const sentence of sentences) {
    if (current.length + sentence.length > targetChars && current.trim()) {
      chunks.push({ text: current.trim(), start: currentStart });
      const overlap = current.slice(-overlapChars);
      currentStart = cursor - overlap.length;
      current = overlap;
    }
    if (!current.trim()) currentStart = cursor;
    current += sentence;
    cursor += sentence.length;
  }
  if (current.trim()) chunks.push({ text: current.trim(), start: currentStart });
  return chunks;
}

/** Basic slug for filenames: "Intro to DNA!" -> "intro-to-dna". */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'untitled'
  );
}
