import type {
  ValidationViolationExtractor,
  ViolationExtractorContext,
} from '../violation-extractor.interface';
import { VALIDATOR_RAW_ERRORS } from '../violation-extractor.interface';
import type { ViolationEntry } from '../validator-collector.interface';

/**
 * Minimal shape of `class-validator`'s `ValidationError` that we consume. Declared
 * locally so this extractor needs no import of `class-validator` — keeping the
 * package validator-agnostic.
 */
interface RawValidationError {
  property: string;
  value?: unknown;
  constraints?: Record<string, string>;
  children?: RawValidationError[];
}

interface WithRawErrors {
  [VALIDATOR_RAW_ERRORS]?: unknown;
}

/** Recursively normalize class-validator errors into the neutral violation shape. */
export function mapClassValidatorErrors(errors: RawValidationError[]): ViolationEntry[] {
  return errors.map((err) => ({
    property: err.property,
    value: err.value,
    constraints: err.constraints ?? {},
    children: err.children?.length ? mapClassValidatorErrors(err.children) : undefined,
  }));
}

function isRawValidationErrorArray(value: unknown): value is RawValidationError[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => typeof item === 'object' && item !== null && 'property' in item)
  );
}

/**
 * Recovers the full property/constraint tree that {@link createClassValidatorPipe}
 * attaches to the thrown exception under the {@link VALIDATOR_RAW_ERRORS} symbol.
 * Returns `null` when the symbol is absent (e.g. a bare `ValidationPipe` without
 * the profiler helper), letting the generic extractor handle the flattened messages.
 */
export const classValidatorExtractor: ValidationViolationExtractor = {
  extract({ error }: ViolationExtractorContext): ViolationEntry[] | null {
    if (typeof error !== 'object' || error === null) return null;
    const raw = (error as WithRawErrors)[VALIDATOR_RAW_ERRORS];
    if (!isRawValidationErrorArray(raw)) return null;
    return mapClassValidatorErrors(raw);
  },
};
