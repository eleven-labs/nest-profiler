import {
  readMessageTraceId,
  resolveTraceIdHeader,
  withTraceIdHeader,
} from './rabbitmq-trace-id.js';

describe('resolveTraceIdHeader', () => {
  it.each([
    [true, 'x-request-id'],
    [' X-Correlation-Id ', 'x-correlation-id'],
    [false, undefined],
    [undefined, undefined],
    ['  ', undefined],
  ])('resolves %p to %p', (option, header) => {
    expect(resolveTraceIdHeader(option)).toBe(header);
  });
});

describe('withTraceIdHeader', () => {
  it('returns the caller options when propagation is off or there is no trace id', () => {
    const options = { headers: {} };
    expect(withTraceIdHeader(options, undefined, 'trace-1')).toBe(options);
    expect(withTraceIdHeader(options, 'x-request-id', undefined)).toBe(options);
  });
});

describe('readMessageTraceId', () => {
  it('reads nothing from a message without headers', () => {
    expect(readMessageTraceId(undefined, 'x-request-id')).toBeUndefined();
    expect(readMessageTraceId({}, 'x-request-id')).toBeUndefined();
  });
});
