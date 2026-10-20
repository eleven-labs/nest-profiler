import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  RESPONSE_CONTENT_TYPE,
  ResponseContentType,
  ResponseContentTypeInterceptor,
} from './response-content-type';

describe('ResponseContentType', () => {
  class Handlers {
    @ResponseContentType('text/html; charset=utf-8')
    page(): string {
      return '<p>hi</p>';
    }

    plain(): string {
      return 'plain';
    }
  }

  // The handlers only serve as metadata targets: never called, so never unbound from `this`.
  /* eslint-disable @typescript-eslint/unbound-method */
  const page = Handlers.prototype.page;
  const plain = Handlers.prototype.plain;
  /* eslint-enable @typescript-eslint/unbound-method */

  const response = { kind: 'platform-response' };
  const setHeader = jest.fn();
  const adapterHost = { httpAdapter: { setHeader } } as unknown as HttpAdapterHost;
  const interceptor = new ResponseContentTypeInterceptor(new Reflector(), adapterHost);

  const contextFor = (handler: () => string): ExecutionContext =>
    ({
      getHandler: () => handler,
      switchToHttp: () => ({ getResponse: () => response }),
    }) as unknown as ExecutionContext;

  const handled = (result: CallHandler['handle']): CallHandler => ({ handle: result });

  beforeEach(() => setHeader.mockClear());

  it('records the Content-Type on the handler', () => {
    const type: unknown = Reflect.getMetadata(RESPONSE_CONTENT_TYPE, page);
    expect(type).toBe('text/html; charset=utf-8');
  });

  it('sets the Content-Type once the handler produced its body', async () => {
    const body = await lastValueFrom(
      interceptor.intercept(
        contextFor(page),
        handled(() => of('<p>hi</p>')),
      ),
    );
    expect(body).toBe('<p>hi</p>');
    expect(setHeader).toHaveBeenCalledWith(response, 'Content-Type', 'text/html; charset=utf-8');
  });

  it('leaves the Content-Type alone when the handler throws', async () => {
    const failure = new Error('not found');
    const result = lastValueFrom(
      interceptor.intercept(
        contextFor(page),
        handled(() => throwError(() => failure)),
      ),
    );
    await expect(result).rejects.toBe(failure);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('does nothing for a handler without a declared Content-Type', async () => {
    await lastValueFrom(
      interceptor.intercept(
        contextFor(plain),
        handled(() => of('plain')),
      ),
    );
    expect(setHeader).not.toHaveBeenCalled();
  });
});
