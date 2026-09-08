import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { toExceptionEntry, resolveExceptionCaptureOptions } from './to-exception-entry';

describe('toExceptionEntry', () => {
  it('records the name, message and stack of an Error', () => {
    const error = new TypeError('bad shape');

    const entry = toExceptionEntry(error);

    expect(entry).toMatchObject({ name: 'TypeError', message: 'bad shape' });
    expect(entry.stack).toBe(error.stack);
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('coerces a non-Error throw exactly as the call sites used to', () => {
    // Unchanged on purpose: `name` backs the `exception` list filter, and existing profiles
    // are grouped under `Error`.
    expect(toExceptionEntry('boom')).toMatchObject({ name: 'Error', message: 'boom' });
    expect(toExceptionEntry(42)).toMatchObject({ name: 'Error', message: '42' });
  });

  it('records the cause of a wrapped error, which is what actually went wrong', () => {
    const root = new Error('connection refused');
    const wrapper = new Error('could not load user', { cause: root });

    const entry = toExceptionEntry(wrapper);

    expect(entry.message).toBe('could not load user');
    expect(entry.cause).toMatchObject({ name: 'Error', message: 'connection refused' });
    expect(entry.cause?.stack).toBe(root.stack);
  });

  it('follows a chain several levels deep', () => {
    const level3 = new Error('socket hang up');
    const level2 = new Error('query failed', { cause: level3 });
    const level1 = new Error('internal server error', { cause: level2 });

    const entry = toExceptionEntry(level1);

    expect(entry.cause?.message).toBe('query failed');
    expect(entry.cause?.cause?.message).toBe('socket hang up');
    expect(entry.cause?.cause?.cause).toBeUndefined();
  });

  it('bounds the chain rather than storing an unbounded one', () => {
    let error = new Error('root');
    for (let i = 0; i < 20; i++) error = new Error(`level ${i}`, { cause: error });

    let depth = 0;
    for (let node = toExceptionEntry(error).cause; node; node = node.cause) depth++;

    expect(depth).toBe(5);
  });

  it('survives a cycle in the cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;

    const entry = toExceptionEntry(a);

    expect(entry.cause?.message).toBe('b');
    // The cycle stops rather than recursing back into `a`.
    expect(entry.cause?.cause).toBeUndefined();
  });

  it('records a non-Error cause too', () => {
    const entry = toExceptionEntry(new Error('wrapped', { cause: 'a string reason' }));
    expect(entry.cause).toMatchObject({ name: 'Error', message: 'a string reason' });
  });

  it('captures a machine-readable code when the error carries one', () => {
    // Node errors and most drivers report one, and it discriminates better than the class name.
    const error = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(toExceptionEntry(error).code).toBe('ENOENT');
  });

  it('ignores a code that is not a usable string', () => {
    expect(toExceptionEntry(Object.assign(new Error('e'), { code: 500 })).code).toBeUndefined();
    expect(toExceptionEntry(Object.assign(new Error('e'), { code: '' })).code).toBeUndefined();
    expect(toExceptionEntry(new Error('plain')).code).toBeUndefined();
  });

  it('omits the code key entirely rather than storing undefined', () => {
    expect('code' in toExceptionEntry(new Error('plain'))).toBe(false);
  });

  it('ignores a null or undefined cause instead of recording an empty one', () => {
    expect(toExceptionEntry(new Error('e', { cause: undefined })).cause).toBeUndefined();
    expect(toExceptionEntry(new Error('e', { cause: null })).cause).toBeUndefined();
  });

  it('stays JSON-serialisable, since the entry is stored and exported', () => {
    const entry = toExceptionEntry(new Error('outer', { cause: new Error('inner') }));
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });

  describe('stack frames', () => {
    const RELATIVE_SPEC_PATH = 'src/analysis/to-exception-entry.spec.ts';

    it('records the frames of the primary error and of its cause', () => {
      const entry = toExceptionEntry(new Error('wrapper', { cause: new Error('root cause') }));

      expect(entry.frames?.[0]?.file).toBe(RELATIVE_SPEC_PATH);
      expect(entry.cause?.frames?.[0]?.file).toBe(RELATIVE_SPEC_PATH);
    });

    it('records the frames with no excerpt when sourceContext is off', () => {
      const entry = toExceptionEntry(new Error('boom'));

      expect(entry.frames?.[0]?.isApplication).toBe(true);
      expect(entry.frames?.[0]?.lines).toBeUndefined();
    });

    it('annotates the frames with a source excerpt when sourceContext is on', () => {
      const entry = toExceptionEntry(new Error('boom'), { sourceContext: { maxFrames: 1 } });

      expect(entry.frames?.[0]?.lines?.some((line) => line.isFaultLine)).toBe(true);
    });
  });

  describe('HttpException payload', () => {
    const capture = resolveExceptionCaptureOptions({});

    it('records the field errors of a rejected DTO, which live nowhere else', () => {
      // What `ValidationPipe` throws: the violations are the payload, and `message` is the
      // generic class message — so without the payload the entry says nothing at all.
      const violations = ['name should not be empty', 'price must not be less than 0'];
      const entry = toExceptionEntry(new BadRequestException(violations), capture);

      expect(entry.message).toBe('Bad Request Exception');
      expect(entry.details).toMatchObject({ statusCode: 400, message: violations });
    });

    it('records a custom payload as it was answered to the client', () => {
      const entry = toExceptionEntry(
        new ConflictException({ statusCode: 409, message: 'Conflict', conflictingId: 42 }),
        capture,
      );

      expect(entry.details).toMatchObject({ conflictingId: 42 });
    });

    it('records nothing for a string payload, which is the message twice over', () => {
      const entry = toExceptionEntry(new NotFoundException('Product #9 not found'), capture);

      expect(entry.message).toBe('Product #9 not found');
      expect('details' in entry).toBe(false);
    });

    it('records nothing for an error that is not an HttpException', () => {
      expect('details' in toExceptionEntry(new Error('boom'), capture)).toBe(false);
    });

    it('records nothing when no capture settings were resolved', () => {
      expect('details' in toExceptionEntry(new BadRequestException(['a']), {})).toBe(false);
    });

    it('masks the payload on the same redaction settings as a body', () => {
      const entry = toExceptionEntry(
        new BadRequestException({ message: 'nope', password: 'hunter2' }),
        resolveExceptionCaptureOptions({ redaction: { keys: ['password'] } }),
      );

      expect(entry.details).toMatchObject({ password: '[REDACTED]' });
    });

    it('records the payload of a cause too', () => {
      const entry = toExceptionEntry(
        new Error('wrapper', { cause: new BadRequestException(['inner violation']) }),
        capture,
      );

      expect(entry.cause?.details).toMatchObject({ message: ['inner violation'] });
    });
  });
});
