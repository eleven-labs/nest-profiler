export { ValidatorCollectorModule } from './validator-collector.module.js';
export type {
  ValidatorCollectorModuleOptions,
  ValidatorCollectorModuleAsyncOptions,
} from './validator-collector.module.js';
export type { ValidationPipeOptions } from '@nestjs/common';
export {
  ProfilerValidationPipe,
  createProfilerValidationPipe,
} from './profiler-validation.pipe.js';
export { ValidatorCollector } from './validator.collector.js';

// Validator adapter + extractors (validator-agnostic capture)
export { createClassValidatorPipe } from './class-validator.adapter.js';
export { DEFAULT_EXTRACTORS } from './default-extractors.js';
export { classValidatorExtractor } from './extractors/class-validator.extractor.js';
export { zodExtractor } from './extractors/zod.extractor.js';
export { genericExtractor } from './extractors/generic.extractor.js';
export type {
  ValidationViolationExtractor,
  ViolationExtractorContext,
} from './violation-extractor.interface.js';
export { VALIDATOR_RAW_ERRORS } from './violation-extractor.interface.js';

export { VALIDATOR_KEY } from './validator-collector.interface.js';
export type {
  ValidationEntry,
  ViolationEntry,
  ValidationStatus,
  ValidationSource,
} from './validator-collector.interface.js';
