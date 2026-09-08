import { toExceptionEntry } from './to-exception-entry';

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

  describe('sourceContext', () => {
    it('omits frames when sourceContext is not passed', () => {
      expect(toExceptionEntry(new Error('boom')).frames).toBeUndefined();
    });

    it('attaches frames for the primary error and its cause when sourceContext is enabled', () => {
      const root = new Error('root cause');
      const wrapper = new Error('wrapper', { cause: root });

      const entry = toExceptionEntry(wrapper, { sourceContext: { maxFrames: 3 } });

      expect(entry.frames?.[0]?.file).toBe(__filename);
      expect(entry.cause?.frames?.[0]?.file).toBe(__filename);
    });
  });
});
