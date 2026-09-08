import {
  captureBody,
  captureHeaders,
  finalizeHttpProfile,
  resolveHttpCaptureConfig,
} from './http-capture.util';
import type { HttpCaptureConfig } from './http-capture.util';
import { markProfileStart } from './profile-metrics.util';
import { DEFAULT_MAX_BODY_SIZE } from './safe-data.utils';
import type { Profile } from '../interfaces/profile.interface';

const AT = 1_700_000_000_000;

function makeProfile(): Profile {
  const profile: Profile = {
    token: 't',
    createdAt: AT,
    entrypoint: { type: 'http', data: {} },
    performance: { startTime: AT, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
  markProfileStart(profile);
  return profile;
}

const collecting: HttpCaptureConfig = resolveHttpCaptureConfig({ collectBody: true });
const notCollecting: HttpCaptureConfig = resolveHttpCaptureConfig({});

describe('resolveHttpCaptureConfig', () => {
  it('defaults to not collecting bodies, with the built-in size cap and masking', () => {
    const config = resolveHttpCaptureConfig({});
    expect(config.collectBody).toBe(false);
    expect(config.maxBodySize).toBe(DEFAULT_MAX_BODY_SIZE);
    expect(config.bodyCaptureLimits).toBeUndefined();
    expect(config.redaction.maskHeaders.has('authorization')).toBe(true);
  });

  it('carries the body bounds set by the host through', () => {
    const config = resolveHttpCaptureConfig({
      collectBody: true,
      maxBodySize: 128,
      bodyCaptureLimits: { maxDepth: 2 },
    });
    expect(config).toMatchObject({
      collectBody: true,
      maxBodySize: 128,
      bodyCaptureLimits: { maxDepth: 2 },
    });
  });
});

describe('captureBody', () => {
  it('redacts sensitive keys in a captured payload', () => {
    expect(captureBody({ user: 'ana', password: 'hunter2' }, collecting)).toEqual({
      user: 'ana',
      password: '[REDACTED]',
    });
  });

  it('bounds the payload before redacting it', () => {
    const config = resolveHttpCaptureConfig({
      collectBody: true,
      bodyCaptureLimits: { maxDepth: 1 },
    });
    const captured = captureBody({ level1: { level2: { password: 'hunter2' } } }, config);
    expect(JSON.stringify(captured)).not.toContain('hunter2');
  });
});

describe('captureHeaders', () => {
  it('masks the configured headers with the configured replacement', () => {
    const config = resolveHttpCaptureConfig({
      redaction: { headers: ['x-tenant'], replacement: '***' },
    });
    expect(
      captureHeaders({ Authorization: 'Bearer t', 'x-tenant': 'acme', accept: '*/*' }, config),
    ).toEqual({ Authorization: '***', 'x-tenant': '***', accept: '*/*' });
  });

  // A repeated header stays a list: joining two `set-cookie` values on ', ' produces a line that
  // is neither of them (their Expires dates contain commas).
  it('keeps a multi-value header as an array', () => {
    expect(captureHeaders({ 'x-forwarded-for': ['10.0.0.1', '10.0.0.2'] }, notCollecting)).toEqual({
      'x-forwarded-for': ['10.0.0.1', '10.0.0.2'],
    });
  });

  it('renders a numeric header value as a string', () => {
    expect(captureHeaders({ 'content-length': 12 }, notCollecting)).toEqual({
      'content-length': '12',
    });
  });
});

describe('finalizeHttpProfile', () => {
  it('records the duration and the response the caller resolved', () => {
    const profile = makeProfile();

    finalizeHttpProfile(
      profile,
      { statusCode: 201, headers: { 'content-type': 'application/json' }, body: { id: 1 } },
      collecting,
    );

    expect(profile.performance.duration).toBeGreaterThanOrEqual(0);
    expect(profile.response).toEqual({
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: { id: 1 },
    });
  });

  it('takes the status from the caller, not from the transport', () => {
    const profile = makeProfile();
    finalizeHttpProfile(profile, { statusCode: 404 }, notCollecting);
    expect(profile.response?.statusCode).toBe(404);
  });

  it('leaves the body out when collectBody is off', () => {
    const profile = makeProfile();
    finalizeHttpProfile(profile, { statusCode: 200, body: { id: 1 } }, notCollecting);
    expect(profile.response?.body).toBeUndefined();
  });

  it('records the body anyway when the caller asks for it (non-HTTP result)', () => {
    const profile = makeProfile();
    finalizeHttpProfile(
      profile,
      { statusCode: 200, body: { id: 1 }, alwaysCaptureBody: true },
      notCollecting,
    );
    expect(profile.response?.body).toEqual({ id: 1 });
  });

  it('reports empty headers when the transport bag is not observable', () => {
    const profile = makeProfile();
    finalizeHttpProfile(profile, { statusCode: 200 }, notCollecting);
    expect(profile.response?.headers).toEqual({});
  });

  it('masks response headers on the same list as the request', () => {
    const profile = makeProfile();
    finalizeHttpProfile(
      profile,
      { statusCode: 200, headers: { 'set-cookie': ['sid=abc'], etag: 'W/"1"' } },
      notCollecting,
    );
    expect(profile.response?.headers).toEqual({ 'set-cookie': '[REDACTED]', etag: 'W/"1"' });
  });
});
