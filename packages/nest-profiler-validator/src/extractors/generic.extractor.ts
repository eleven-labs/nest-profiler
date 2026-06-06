import type {
  ValidationViolationExtractor,
  ViolationExtractorContext,
} from '../violation-extractor.interface';
import type { ViolationEntry } from '../validator-collector.interface';

interface HttpExceptionLike {
  getResponse?: unknown;
}

interface ExceptionResponseLike {
  message?: unknown;
}

/** Normalize an `HttpException` response payload into a list of message strings. */
function toMessages(response: unknown): string[] | null {
  if (typeof response === 'string') return [response];
  if (typeof response !== 'object' || response === null) return null;

  const message = (response as ExceptionResponseLike).message;
  if (typeof message === 'string') return [message];
  if (Array.isArray(message)) {
    const strings = (message as unknown[]).filter((m): m is string => typeof m === 'string');
    return strings.length > 0 ? strings : null;
  }
  return null;
}

/**
 * Universal fallback: turns any `HttpException`-like error (anything exposing
 * `getResponse()`, e.g. NestJS's default `BadRequestException`) into violations,
 * one per message. Property is unknown at this level, so messages are surfaced
 * under a single `(unknown)` entry's constraints. Returns `null` when the error
 * exposes no usable message.
 */
export const genericExtractor: ValidationViolationExtractor = {
  extract({ error }: ViolationExtractorContext): ViolationEntry[] | null {
    if (typeof error !== 'object' || error === null) return null;
    const exception = error as HttpExceptionLike;
    if (typeof exception.getResponse !== 'function') return null;

    const response: unknown = (exception.getResponse as () => unknown)();
    const messages = toMessages(response);
    if (!messages) return null;

    return messages.map((message) => ({
      property: '(unknown)',
      constraints: { error: message },
    }));
  },
};
