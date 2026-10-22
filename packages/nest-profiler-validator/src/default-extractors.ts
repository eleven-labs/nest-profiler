import type { ValidationViolationExtractor } from './violation-extractor.interface.js';
import { classValidatorExtractor } from './extractors/class-validator.extractor.js';
import { zodExtractor } from './extractors/zod.extractor.js';
import { genericExtractor } from './extractors/generic.extractor.js';

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
