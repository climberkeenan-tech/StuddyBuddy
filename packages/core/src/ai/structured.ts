import type { Logger } from '../infra/logger';
import { ErrorCodes, SbError } from '../infra/errors';
import type { AIProvider, StructuredRequest } from './types';

/**
 * Prompt an LLM for JSON matching a zod schema, with automatic extraction,
 * validation, and bounded repair retries. This is the single path every
 * feature uses to get structured data out of a model, so provider quirks
 * (code fences, chatter around the JSON) are handled once, here.
 */
export type StructuredGenerator = <T>(request: StructuredRequest<T>) => Promise<T>;

/** Pull the first plausible JSON value out of a model response. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const firstObj = body.indexOf('{');
  const firstArr = body.indexOf('[');
  let start = -1;
  if (firstObj >= 0 && firstArr >= 0) start = Math.min(firstObj, firstArr);
  else start = Math.max(firstObj, firstArr);
  if (start < 0) return body;
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  return end > start ? body.slice(start, end + 1) : body.slice(start);
}

export function createStructuredGenerator(
  getProvider: () => AIProvider,
  logger: Logger,
): StructuredGenerator {
  return async <T>(request: StructuredRequest<T>): Promise<T> => {
    const provider = getProvider();
    const attempts = 1 + (request.repairAttempts ?? 2);
    const system =
      `${request.system}\n\n` +
      `Respond with ONLY a single valid JSON value for "${request.schemaName}". ` +
      `No prose, no markdown fences, no comments — just JSON.`;

    let lastFailure = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const user =
        attempt === 1
          ? request.user
          : `${request.user}\n\nYour previous response was invalid JSON for "${request.schemaName}":\n${lastFailure}\nReturn corrected JSON only.`;

      const result = await provider.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: request.temperature ?? 0.4,
        maxTokens: request.maxTokens ?? 8192,
        jsonMode: true,
      });

      let parsedUnknown: unknown;
      try {
        parsedUnknown = JSON.parse(extractJson(result.text));
      } catch (e) {
        lastFailure = `JSON.parse failed: ${(e as Error).message}`;
        logger.warn('structured output parse failure', {
          schema: request.schemaName,
          attempt,
          provider: provider.info.id,
        });
        continue;
      }

      const validated = request.schema.safeParse(parsedUnknown);
      if (validated.success) return validated.data;

      lastFailure = `Schema validation failed: ${validated.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`;
      logger.warn('structured output schema failure', {
        schema: request.schemaName,
        attempt,
        issues: validated.error.issues.length,
      });
    }

    throw new SbError(
      ErrorCodes.AI_BAD_OUTPUT,
      `The AI provider (${provider.info.id}) did not return valid ${request.schemaName} after ${attempts} attempts.`,
      { details: { lastFailure }, retryable: true },
    );
  };
}
