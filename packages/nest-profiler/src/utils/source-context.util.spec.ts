import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSourceContext } from './source-context.util';

describe('buildSourceContext', () => {
  it('returns undefined when there is no stack', () => {
    expect(buildSourceContext(undefined)).toBeUndefined();
  });

  it('returns undefined when the stack carries no readable application frame', () => {
    const stack = [
      'Error: boom',
      '    at internal (node:internal/process/task_queues:95:5)',
      '    at Module._compile (node:internal/modules/cjs/loader:1105:14)',
    ].join('\n');
    expect(buildSourceContext(stack)).toBeUndefined();
  });

  it('reads context lines around the fault line of an application frame under cwd', () => {
    const stack = ['Error: boom', `    at Object.<anonymous> (${__filename}:3:1)`].join('\n');
    const frames = buildSourceContext(stack, { linesOfContext: 1 });
    expect(frames).toHaveLength(1);
    expect(frames?.[0]?.file).toBe(__filename);
    expect(frames?.[0]?.line).toBe(3);
    expect(frames?.[0]?.lines.some((l) => l.isFaultLine && l.number === 3)).toBe(true);
    // 1 line of context each side + the fault line itself.
    expect(frames?.[0]?.lines.length).toBeLessThanOrEqual(3);
  });

  it('rejects a frame pointing outside process.cwd()', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiler-source-context-'));
    const outsideFile = join(dir, 'outside.ts');
    writeFileSync(outsideFile, 'const secret = 1;\n');
    try {
      const stack = ['Error: boom', `    at Object.<anonymous> (${outsideFile}:1:1)`].join('\n');
      expect(buildSourceContext(stack)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a frame with a disallowed extension', () => {
    const stack = [
      'Error: boom',
      `    at Object.<anonymous> (${join(process.cwd(), 'package.json')}:1:1)`,
    ].join('\n');
    expect(buildSourceContext(stack)).toBeUndefined();
  });

  it('skips node_modules frames', () => {
    const stack = [
      'Error: boom',
      `    at Object.<anonymous> (${join(process.cwd(), 'node_modules', 'x', 'index.js')}:1:1)`,
    ].join('\n');
    expect(buildSourceContext(stack)).toBeUndefined();
  });

  it('caps the number of frames at maxFrames', () => {
    const line = `    at Object.<anonymous> (${__filename}:1:1)`;
    const stack = ['Error: boom', line, line, line, line, line].join('\n');
    const frames = buildSourceContext(stack, { maxFrames: 2 });
    expect(frames).toHaveLength(2);
  });

  it('never throws on a malformed stack', () => {
    expect(() => buildSourceContext('not a real stack at all')).not.toThrow();
    expect(buildSourceContext('not a real stack at all')).toBeUndefined();
  });
});

describe('buildSourceContext — frames with no readable excerpt', () => {
  it('skips a frame whose line number is past the end of the file', () => {
    const file = join(process.cwd(), 'src', 'utils', 'source-context.util.ts');
    const stack = `Error: boom\n    at fake (${file}:9999999:1)`;
    expect(buildSourceContext(stack)).toBeUndefined();
  });
});

describe('parseStackFrames — hardening against an untrusted stack', () => {
  it('parses a frame with no named function', () => {
    const stack = `Error: boom\n    at ${__filename}:3:1`;
    expect(buildSourceContext(stack, { linesOfContext: 0 })?.[0]?.function).toBeUndefined();
  });

  it('returns quickly on a line crafted to backtrack a naive frame pattern', () => {
    const start = performance.now();
    expect(buildSourceContext(`at ${' '.repeat(50_000)}`)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(500);
  });
});
