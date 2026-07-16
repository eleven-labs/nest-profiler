export { ValidatorCollectorModule } from './validator-collector.module';
export type {
  ValidatorCollectorModuleOptions,
  ValidatorCollectorModuleAsyncOptions,
} from './validator-collector.module';
export type { ValidationPipeOptions } from '@nestjs/common';
export { ProfilerValidationPipe, createProfilerValidationPipe } from './profiler-validation.pipe';
export { ValidatorCollector } from './validator.collector';

// Validator adapter + extractors (validator-agnostic capture)
export { createClassValidatorPipe } from './class-validator.adapter';
export { DEFAULT_EXTRACTORS } from './default-extractors';
export { classValidatorExtractor } from './extractors/class-validator.extractor';
export { zodExtractor } from './extractors/zod.extractor';
export { genericExtractor } from './extractors/generic.extractor';
export type {
  ValidationViolationExtractor,
  ViolationExtractorContext,
} from './violation-extractor.interface';
export { VALIDATOR_RAW_ERRORS } from './violation-extractor.interface';

export { VALIDATOR_KEY } from './validator-collector.interface';
export type {
  ValidationEntry,
  ViolationEntry,
  ValidationStatus,
  ValidationSource,
} from './validator-collector.interface';
