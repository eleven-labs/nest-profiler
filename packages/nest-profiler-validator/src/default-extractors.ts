import type { ValidationViolationExtractor } from './violation-extractor.interface';
import { classValidatorExtractor } from './extractors/class-validator.extractor';
import { zodExtractor } from './extractors/zod.extractor';
import { genericExtractor } from './extractors/generic.extractor';

/**
 * Built-in extractor chain, tried in order. Rich, validator-specific extractors
 * come first (class-validator via its attached raw errors, then zod); the
 * generic message-based fallback runs last so it only handles errors the
 * specific extractors did not recognize.
 */
export const DEFAULT_EXTRACTORS: readonly ValidationViolationExtractor[] = [
  classValidatorExtractor,
  zodExtractor,
  genericExtractor,
];
