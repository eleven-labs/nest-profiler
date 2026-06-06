import type {
  ValidationViolationExtractor,
  ViolationExtractorContext,
} from '../violation-extractor.interface';
import type { ViolationEntry } from '../validator-collector.interface';

/**
 * Minimal shapes we duck-type from zod / nestjs-zod. Declared locally so this
 * extractor imports neither `zod` nor `nestjs-zod`.
 */
interface ZodIssueLike {
  code?: unknown;
  message?: unknown;
  path?: unknown;
}

interface ZodErrorLike {
  issues?: unknown;
  /** zod v3 alias for `issues`; kept as a fallback for older zod versions. */
  errors?: unknown;
}

interface ZodExceptionLike {
  getZodError?: unknown;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null;
}

/** Pull the `ZodIssue[]` out of a `ZodError`, a nestjs-zod exception, or `null`. */
function resolveZodIssues(error: unknown): unknown[] | null {
  if (typeof error !== 'object' || error === null) return null;

  const exception = error as ZodExceptionLike;
  if (typeof exception.getZodError === 'function') {
    const zodError: unknown = (exception.getZodError as () => unknown)();
    return readIssues(zodError);
  }

  return readIssues(error);
}

function readIssues(zodError: unknown): unknown[] | null {
  if (typeof zodError !== 'object' || zodError === null) return null;
  const candidate = zodError as ZodErrorLike;
  return asArray(candidate.issues) ?? asArray(candidate.errors);
}

function formatPath(path: unknown): string {
  const segments = asArray(path);
  if (!segments || segments.length === 0) return '(root)';
  return segments
    .map((seg: unknown) => {
      if (typeof seg === 'object' && seg !== null && 'key' in seg) {
        return String(seg.key);
      }
      return String(seg);
    })
    .join('.');
}

/** Group issues by their path so each property yields a single violation entry. */
function mapZodIssues(issues: unknown[]): ViolationEntry[] {
  const byPath = new Map<string, ViolationEntry>();
  for (const raw of issues) {
    if (typeof raw !== 'object' || raw === null) continue;
    const issue = raw as ZodIssueLike;
    const property = formatPath(issue.path);
    const code = typeof issue.code === 'string' ? issue.code : 'invalid';
    const message = typeof issue.message === 'string' ? issue.message : 'Invalid value';
    const existing = byPath.get(property);
    if (existing) {
      existing.constraints[code] = message;
    } else {
      byPath.set(property, { property, constraints: { [code]: message } });
    }
  }
  return [...byPath.values()];
}

/**
 * Extracts violations from a `ZodError` or a nestjs-zod `ZodValidationException`.
 * Reads `zodError.issues` (zod v4), falling back to `.errors` (zod v3). Returns
 * `null` when the error is not zod-shaped.
 */
export const zodExtractor: ValidationViolationExtractor = {
  extract({ error }: ViolationExtractorContext): ViolationEntry[] | null {
    const issues = resolveZodIssues(error);
    if (!issues) return null;
    return mapZodIssues(issues);
  },
};
