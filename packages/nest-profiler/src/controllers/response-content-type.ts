import { applyDecorators, Injectable, SetMetadata, UseInterceptors } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';

/** Metadata key holding the Content-Type a profiler route serves its successful body with. */
export const RESPONSE_CONTENT_TYPE = 'nest-profiler:response-content-type';

/**
 * Sets a route's Content-Type once its handler has produced the body. `@Header('Content-Type')`
 * applies before the handler runs, so a thrown `NotFoundException` would send its JSON error body
 * under the page's HTML/CSS/JS type, and Nest warns "Content-Type doesn't match Reply body".
 */
@Injectable()
export class ResponseContentTypeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const type = this.reflector.get<string | undefined>(
      RESPONSE_CONTENT_TYPE,
      context.getHandler(),
    );
    if (!type) return next.handle();
    const response: unknown = context.switchToHttp().getResponse();
    return next.handle().pipe(
      tap(() => {
        this.adapterHost.httpAdapter.setHeader(response, 'Content-Type', type);
      }),
    );
  }
}

/** Declares the Content-Type of a route's successful body; error responses keep their own. */
export const ResponseContentType = (type: string): MethodDecorator =>
  applyDecorators(
    SetMetadata(RESPONSE_CONTENT_TYPE, type),
    UseInterceptors(ResponseContentTypeInterceptor),
  );
