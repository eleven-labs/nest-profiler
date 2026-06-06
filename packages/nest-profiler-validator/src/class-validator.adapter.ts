import { ValidationPipe } from '@nestjs/common';
import type { PipeTransform, ValidationPipeOptions } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { VALIDATOR_RAW_ERRORS } from './violation-extractor.interface';

/**
 * `ValidationPipe` subclass that attaches the raw class-validator
 * `ValidationError[]` onto the exception it throws (under {@link VALIDATOR_RAW_ERRORS}),
 * so the class-validator extractor can recover the full property/constraint tree
 * that NestJS would otherwise flatten into plain message strings.
 *
 * It wraps the resolved `exceptionFactory` (default or user-supplied) instead of
 * replacing it, so the HTTP 400 response stays byte-for-byte identical.
 *
 * `ValidationPipe`'s constructor eagerly `require()`s `class-validator` and
 * `class-transformer`; instantiating this class is therefore the single point
 * where those packages become a runtime requirement. Merely importing this
 * module does not construct it.
 */
class ClassValidatorCapturePipe extends ValidationPipe {
  constructor(options: ValidationPipeOptions = {}) {
    super(options);
    const buildException = this.exceptionFactory as (errors: ValidationError[]) => unknown;
    this.exceptionFactory = (errors: ValidationError[]): unknown => {
      const exception = buildException(errors);
      if (typeof exception === 'object' && exception !== null) {
        Reflect.set(exception, VALIDATOR_RAW_ERRORS, errors);
      }
      return exception;
    };
  }
}

/**
 * Builds a class-validator `ValidationPipe` instrumented for the profiler.
 * Use this as the `pipe` option (or rely on it as the default) so the Validator
 * panel shows per-property constraints rather than flattened messages.
 *
 * Requires `class-validator` and `class-transformer` to be installed.
 */
export function createClassValidatorPipe(options: ValidationPipeOptions = {}): PipeTransform {
  return new ClassValidatorCapturePipe(options);
}
