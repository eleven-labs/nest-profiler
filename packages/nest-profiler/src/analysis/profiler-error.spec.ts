import {
  resolveEntryErrorClassifier,
  resolveErrorSeverity,
  resolveProfileErrorClassifier,
} from './profiler-error';
import type { ExceptionEntry, Profile, ResponseData } from '../interfaces/profile.interface';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    token: 'tok',
    createdAt: Date.now(),
    entrypoint: { type: 'http', data: { method: 'GET', url: '/', headers: {}, query: {} } },
    performance: { startTime: Date.now(), heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
    ...overrides,
  };
}

function exception(name: string, code?: string): ExceptionEntry {
  return { name, message: `${name} raised`, timestamp: Date.now(), ...(code ? { code } : {}) };
}

const response = (statusCode: number): ResponseData => ({ statusCode, headers: {} });

describe('resolveProfileErrorClassifier', () => {
  describe('defaults', () => {
    const isError = resolveProfileErrorClassifier();

    it('treats a 5xx response as an error', () => {
      expect(isError(makeProfile({ response: response(500) }))).toBe(true);
      expect(isError(makeProfile({ response: response(503) }))).toBe(true);
    });

    it.each([200, 301, 400, 401, 403, 404, 422, 499])('does not treat %d as an error', (status) => {
      expect(isError(makeProfile({ response: response(status) }))).toBe(false);
    });

    // The pivot case: a NotFoundException produces BOTH a captured exception and a 404. The
    // status layer must settle it alone, or the two layers contradict each other.
    it('does not treat a 404 as an error even when its exception was captured', () => {
      const profile = makeProfile({
        response: response(404),
        exceptions: [exception('NotFoundException')],
      });
      expect(isError(profile)).toBe(false);
    });

    it('treats a captured exception as an error when no status was recorded', () => {
      expect(isError(makeProfile({ exceptions: [exception('TypeError')] }))).toBe(true);
    });

    it('is not an error when there is neither a status nor an exception', () => {
      expect(isError(makeProfile())).toBe(false);
    });
  });

  describe('httpStatus layer', () => {
    it('counts 4xx when lowered to 400', () => {
      const isError = resolveProfileErrorClassifier({ httpStatus: 400 });
      expect(isError(makeProfile({ response: response(404) }))).toBe(true);
      expect(isError(makeProfile({ response: response(200) }))).toBe(false);
    });

    it('accepts a predicate', () => {
      const isError = resolveProfileErrorClassifier({
        httpStatus: (code) => code === 418 || code >= 500,
      });
      expect(isError(makeProfile({ response: response(418) }))).toBe(true);
      expect(isError(makeProfile({ response: response(404) }))).toBe(false);
      expect(isError(makeProfile({ response: response(500) }))).toBe(true);
    });

    it('falls through to the exceptions layer when disabled', () => {
      const isError = resolveProfileErrorClassifier({ httpStatus: false });
      // A 200 that carries an exception — the GraphQL shape.
      const profile = makeProfile({
        response: response(200),
        exceptions: [exception('GraphQLError')],
      });
      expect(isError(profile)).toBe(true);
      expect(isError(makeProfile({ response: response(500) }))).toBe(false);
    });
  });

  describe('exceptions layer', () => {
    it('is disabled by `exceptions: false`', () => {
      const isError = resolveProfileErrorClassifier({ exceptions: false });
      expect(isError(makeProfile({ exceptions: [exception('TypeError')] }))).toBe(false);
    });

    it('restricts to a list of class names', () => {
      const isError = resolveProfileErrorClassifier({ exceptions: ['TimeoutError'] });
      expect(isError(makeProfile({ exceptions: [exception('TimeoutError')] }))).toBe(true);
      expect(isError(makeProfile({ exceptions: [exception('ValidationError')] }))).toBe(false);
    });

    it('accepts a predicate', () => {
      const isError = resolveProfileErrorClassifier({
        exceptions: (e) => e.message.includes('raised'),
      });
      expect(isError(makeProfile({ exceptions: [exception('TypeError')] }))).toBe(true);
    });

    it('is an error as soon as one of several exceptions counts', () => {
      const isError = resolveProfileErrorClassifier({ exceptions: ['TimeoutError'] });
      const profile = makeProfile({
        exceptions: [exception('ValidationError'), exception('TimeoutError')],
      });
      expect(isError(profile)).toBe(true);
    });
  });

  describe('codes layer', () => {
    // The GraphQL default: the transport status says nothing, `extensions.code` is the verdict.
    const isError = resolveProfileErrorClassifier(undefined, {
      httpStatus: false,
      codes: ['INTERNAL_SERVER_ERROR'],
    });

    it('counts a listed code', () => {
      const profile = makeProfile({
        response: response(200),
        exceptions: [exception('GraphQLError', 'INTERNAL_SERVER_ERROR')],
      });
      expect(isError(profile)).toBe(true);
    });

    it('does not count an unlisted code', () => {
      const profile = makeProfile({
        response: response(200),
        exceptions: [exception('GraphQLError', 'BAD_USER_INPUT')],
      });
      expect(isError(profile)).toBe(false);
    });

    it('counts an exception carrying no code — an unmapped throw is a genuine failure', () => {
      const profile = makeProfile({ exceptions: [exception('TypeError')] });
      expect(isError(profile)).toBe(true);
    });
  });

  describe('classify layer', () => {
    it('settles the verdict when it returns a boolean', () => {
      const isError = resolveProfileErrorClassifier({ classify: () => true });
      expect(isError(makeProfile({ response: response(200) }))).toBe(true);

      const never = resolveProfileErrorClassifier({ classify: () => false });
      expect(never(makeProfile({ response: response(500) }))).toBe(false);
    });

    it('defers to the layers below when it returns undefined', () => {
      const isError = resolveProfileErrorClassifier({ classify: () => undefined });
      expect(isError(makeProfile({ response: response(500) }))).toBe(true);
      expect(isError(makeProfile({ response: response(404) }))).toBe(false);
    });

    it('receives the pre-extracted fields and the profile', () => {
      const classify = jest.fn().mockReturnValue(undefined);
      const profile = makeProfile({
        response: response(404),
        exceptions: [exception('NotFoundException')],
      });
      resolveProfileErrorClassifier({ classify })(profile);

      expect(classify).toHaveBeenCalledWith({
        type: 'http',
        statusCode: 404,
        exceptions: profile.exceptions,
        profile,
      });
    });

    // A command decides on its entrypoint payload, which no other layer can see.
    it('can decide from the entrypoint payload alone', () => {
      const isError = resolveProfileErrorClassifier({
        classify: ({ profile }) =>
          (profile.entrypoint.data as { success: boolean }).success === false,
      });
      const failed = makeProfile({ entrypoint: { type: 'command', data: { success: false } } });
      const ok = makeProfile({ entrypoint: { type: 'command', data: { success: true } } });

      expect(isError(failed)).toBe(true);
      expect(isError(ok)).toBe(false);
    });
  });

  describe('defaults merging', () => {
    it("lets the host's options override the kind's default key by key", () => {
      const isError = resolveProfileErrorClassifier(
        { codes: ['BAD_USER_INPUT'] },
        { httpStatus: false, codes: ['INTERNAL_SERVER_ERROR'] },
      );
      const badInput = makeProfile({
        response: response(200),
        exceptions: [exception('GraphQLError', 'BAD_USER_INPUT')],
      });
      const internal = makeProfile({
        response: response(200),
        exceptions: [exception('GraphQLError', 'INTERNAL_SERVER_ERROR')],
      });

      // `codes` is overridden; the untouched `httpStatus: false` default still applies.
      expect(isError(badInput)).toBe(true);
      expect(isError(internal)).toBe(false);
    });

    it('does not let an absent option blank out the default', () => {
      const isError = resolveProfileErrorClassifier({ severity: 'warning' }, { httpStatus: 400 });
      expect(isError(makeProfile({ response: response(404) }))).toBe(true);
    });
  });
});

describe('resolveErrorSeverity', () => {
  it('defaults to danger', () => {
    expect(resolveErrorSeverity()).toBe('danger');
  });

  it("prefers the option over the kind's default", () => {
    expect(resolveErrorSeverity({ severity: 'warning' }, { severity: 'info' })).toBe('warning');
    expect(resolveErrorSeverity(undefined, { severity: 'info' })).toBe('info');
  });
});

describe('resolveEntryErrorClassifier', () => {
  const isError = resolveEntryErrorClassifier();

  it('counts an entry carrying an error, whatever its status', () => {
    expect(isError({ duration: 5, error: 'ECONNREFUSED' })).toBe(true);
    expect(isError({ duration: 5, error: 'boom', statusCode: 200 } as never)).toBe(true);
  });

  it('counts a 5xx entry and spares a 4xx one', () => {
    expect(isError({ duration: 5, statusCode: 500 } as never)).toBe(true);
    expect(isError({ duration: 5, statusCode: 404 } as never)).toBe(false);
    expect(isError({ duration: 5, statusCode: 200 } as never)).toBe(false);
  });

  it('does not count an entry with no status and no error — a SQL query that ran', () => {
    expect(isError({ duration: 5 })).toBe(false);
  });

  it('counts 4xx when lowered to 400', () => {
    const strict = resolveEntryErrorClassifier({ httpStatus: 400 });
    expect(strict({ duration: 5, statusCode: 404 } as never)).toBe(true);
  });

  it('ignores statuses when the layer is disabled, keeping the entry error', () => {
    const lenient = resolveEntryErrorClassifier({ httpStatus: false });
    expect(lenient({ duration: 5, statusCode: 500 } as never)).toBe(false);
    expect(lenient({ duration: 5, error: 'boom' })).toBe(true);
  });

  it('lets classify settle it, or defer with undefined', () => {
    const custom = resolveEntryErrorClassifier({
      classify: (entry) =>
        (entry as { statusCode?: number }).statusCode === 404 ? true : undefined,
    });
    expect(custom({ duration: 5, statusCode: 404 } as never)).toBe(true);
    expect(custom({ duration: 5, statusCode: 500 } as never)).toBe(true);
    expect(custom({ duration: 5, statusCode: 200 } as never)).toBe(false);
  });
});
