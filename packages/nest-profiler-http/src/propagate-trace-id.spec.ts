import { hasHeader, outgoingTraceId, resolveTraceIdHeader } from './propagate-trace-id';
import type { ClsService } from 'nestjs-cls';

/** A CLS stand-in returning a fixed trace id, or throwing as it does outside a context. */
function clsWith(traceId: string | undefined, throws = false): ClsService {
  return {
    get: (key: string) => {
      if (throws) throw new Error('No CLS context available');
      return key === 'profiler.traceId' ? traceId : undefined;
    },
  } as unknown as ClsService;
}

describe('resolveTraceIdHeader', () => {
  it('is off unless the host asks for it', () => {
    // Adding a header to an application's outgoing traffic is a visible change, and some upstreams
    // sign or validate the header set they receive — so it cannot be a default.
    expect(resolveTraceIdHeader(undefined)).toBeUndefined();
    expect(resolveTraceIdHeader(false)).toBeUndefined();
  });

  it('uses the same default header the profiler adopts on the way in', () => {
    expect(resolveTraceIdHeader(true)).toBe('x-request-id');
  });

  it('accepts a custom header, normalized', () => {
    expect(resolveTraceIdHeader('X-Correlation-Id')).toBe('x-correlation-id');
    expect(resolveTraceIdHeader('  x-trace  ')).toBe('x-trace');
  });

  it('treats a blank name as no propagation rather than an empty header', () => {
    expect(resolveTraceIdHeader('   ')).toBeUndefined();
  });
});

describe('outgoingTraceId', () => {
  it('returns the active trace id when propagation is on', () => {
    expect(outgoingTraceId(clsWith('trace-1'), 'x-request-id')).toBe('trace-1');
  });

  it('returns nothing when propagation is off, whatever the context holds', () => {
    expect(outgoingTraceId(clsWith('trace-1'), undefined)).toBeUndefined();
  });

  it('returns nothing outside a profiled request', () => {
    // A call made during bootstrap or from a background task: propagation is an aid, never a
    // precondition for the call.
    expect(outgoingTraceId(clsWith(undefined), 'x-request-id')).toBeUndefined();
    expect(outgoingTraceId(undefined, 'x-request-id')).toBeUndefined();
    expect(outgoingTraceId(clsWith('trace-1', true), 'x-request-id')).toBeUndefined();
  });
});

describe('hasHeader', () => {
  it('detects a header on a plain object, case-insensitively', () => {
    expect(hasHeader({ 'X-Request-Id': 'mine' }, 'x-request-id')).toBe(true);
    expect(hasHeader({ 'content-type': 'application/json' }, 'x-request-id')).toBe(false);
  });

  it('detects a header on a Headers instance', () => {
    const headers = new Headers({ 'x-request-id': 'mine' });
    expect(hasHeader(headers, 'X-Request-Id')).toBe(true);
    expect(hasHeader(new Headers(), 'x-request-id')).toBe(false);
  });

  it('reports nothing for a value that carries no headers at all', () => {
    expect(hasHeader(undefined, 'x-request-id')).toBe(false);
    expect(hasHeader('not headers', 'x-request-id')).toBe(false);
  });

  it('reports nothing when the lookup itself throws', () => {
    const hostile = {
      has: () => {
        throw new Error('nope');
      },
    };
    expect(hasHeader(hostile, 'x-request-id')).toBe(false);
  });
});
