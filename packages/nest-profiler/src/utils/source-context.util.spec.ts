import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  analyzeStack,
  resolveSourceContextOptions,
  resolveStackAnalysisOptions,
} from './source-context.util';
import type { SourceCodeFrame } from './source-context.util';

/** The excerpt settings every test that wants source uses, unless it tunes them itself. */
const WITH_SOURCE = { sourceContext: {} };

function frameAt(frames: SourceCodeFrame[] | undefined, file: string): SourceCodeFrame | undefined {
  return frames?.find((frame) => frame.file.endsWith(file));
}

describe('analyzeStack', () => {
  it('returns undefined when there is no stack', () => {
    expect(analyzeStack(undefined)).toBeUndefined();
  });

  it('returns undefined when no line of the stack parses as a frame', () => {
    expect(analyzeStack('Error: boom\n  not a frame at all')).toBeUndefined();
  });

  it('keeps dependency and Node-internal frames, flagged as non-application', () => {
    const stack = [
      'Error: boom',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      `    at InsertQueryBuilder.execute (${join(process.cwd(), 'node_modules', 'typeorm', 'query-builder', 'InsertQueryBuilder.js')}:166:33)`,
    ].join('\n');

    const frames = analyzeStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames?.every((frame) => frame.isApplication)).toBe(false);
    expect(frames?.[0]?.file).toBe('node:internal/process/task_queues');
    expect(frames?.[0]?.function).toBe('process.processTicksAndRejections');
  });

  it('shortens a dependency path to its own package root, pnpm store included', () => {
    const pnpmPath = join(
      process.cwd(),
      'node_modules',
      '.pnpm',
      'typeorm@0.3.27',
      'node_modules',
      'typeorm',
      'query-builder',
      'InsertQueryBuilder.js',
    );
    const frames = analyzeStack(`Error: boom\n    at execute (${pnpmPath}:166:33)`);
    expect(frames?.[0]?.file).toBe('typeorm/query-builder/InsertQueryBuilder.js');
    expect(frames?.[0]?.absoluteFile).toBeUndefined();
  });

  it('reports an application frame relative to the project root, with its absolute path', () => {
    const stack = `Error: boom\n    at Object.<anonymous> (${__filename}:3:1)`;
    const frames = analyzeStack(stack, WITH_SOURCE);

    expect(frames).toHaveLength(1);
    expect(frames?.[0]?.isApplication).toBe(true);
    expect(frames?.[0]?.file).toBe('src/utils/source-context.util.spec.ts');
    expect(frames?.[0]?.absoluteFile).toBe(__filename);
    expect(frames?.[0]?.column).toBe(1);
  });

  it('reads context lines around the fault line of an application frame', () => {
    const stack = `Error: boom\n    at Object.<anonymous> (${__filename}:3:1)`;
    const frames = analyzeStack(stack, { sourceContext: { linesOfContext: 1 } });

    const lines = frames?.[0]?.lines;
    expect(lines?.some((line) => line.isFaultLine && line.number === 3)).toBe(true);
    // 1 line of context each side + the fault line itself.
    expect(lines?.length).toBeLessThanOrEqual(3);
  });

  it('records the frame but reads no source when sourceContext is off', () => {
    const stack = `Error: boom\n    at Object.<anonymous> (${__filename}:3:1)`;
    const frames = analyzeStack(stack);

    expect(frames).toHaveLength(1);
    expect(frames?.[0]?.isApplication).toBe(true);
    expect(frames?.[0]?.lines).toBeUndefined();
  });

  it('treats a frame outside the project root as non-application and never reads it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'profiler-source-context-'));
    const outsideFile = join(dir, 'outside.ts');
    writeFileSync(outsideFile, 'const secret = 1;\n');
    try {
      const stack = `Error: boom\n    at Object.<anonymous> (${outsideFile}:1:1)`;
      const frames = analyzeStack(stack, WITH_SOURCE);
      expect(frames).toHaveLength(1);
      expect(frames?.[0]?.isApplication).toBe(false);
      expect(frames?.[0]?.lines).toBeUndefined();
      expect(frames?.[0]?.absoluteFile).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('honours a projectRoot other than the process cwd', () => {
    const stack = `Error: boom\n    at Object.<anonymous> (${__filename}:3:1)`;
    const frames = analyzeStack(stack, {
      projectRoot: join(process.cwd(), 'src', 'utils'),
      sourceContext: {},
    });

    expect(frames?.[0]?.file).toBe('source-context.util.spec.ts');
    expect(frames?.[0]?.lines?.length).toBeGreaterThan(0);
  });

  it('reads no source for an application frame with a disallowed extension', () => {
    const stack = `Error: boom\n    at Object.<anonymous> (${join(process.cwd(), 'package.json')}:1:1)`;
    const frames = analyzeStack(stack, WITH_SOURCE);

    expect(frames?.[0]?.isApplication).toBe(true);
    expect(frames?.[0]?.lines).toBeUndefined();
  });

  it('reads no source for a line number past the end of the file', () => {
    const file = join(process.cwd(), 'src', 'utils', 'source-context.util.ts');
    const frames = analyzeStack(`Error: boom\n    at fake (${file}:9999999:1)`, WITH_SOURCE);

    expect(frames?.[0]?.isApplication).toBe(true);
    expect(frames?.[0]?.lines).toBeUndefined();
  });

  it('caps annotated frames at maxFrames while keeping every frame', () => {
    const line = `    at Object.<anonymous> (${__filename}:1:1)`;
    const stack = ['Error: boom', line, line, line, line, line].join('\n');
    const frames = analyzeStack(stack, { sourceContext: { maxFrames: 2 } });

    expect(frames).toHaveLength(5);
    expect(frames?.filter((frame) => frame.lines !== undefined)).toHaveLength(2);
  });

  it('caps the frames it keeps, so one exception cannot flood storage', () => {
    const line = `    at deep (${__filename}:1:1)`;
    const stack = ['Error: boom', ...Array.from({ length: 200 }, () => line)].join('\n');
    expect(analyzeStack(stack)).toHaveLength(50);
  });

  it('never throws on a malformed stack', () => {
    expect(() => analyzeStack('not a real stack at all')).not.toThrow();
    expect(analyzeStack('not a real stack at all')).toBeUndefined();
  });
});

describe('analyzeStack — V8 frame decorations', () => {
  it('flags an awaited frame and keeps `async` out of the function name', () => {
    const frames = analyzeStack(
      `Error: boom\n    at async ProductService.create (${__filename}:3:1)`,
    );
    expect(frames?.[0]?.function).toBe('ProductService.create');
    expect(frames?.[0]?.isAsync).toBe(true);
  });

  it('parses an awaited frame that carries no function name', () => {
    const frames = analyzeStack(`Error: boom\n    at async ${__filename}:3:1`);
    expect(frames?.[0]?.file).toBe('src/utils/source-context.util.spec.ts');
    expect(frames?.[0]?.isAsync).toBe(true);
    expect(frames?.[0]?.function).toBeUndefined();
  });

  it('strips the `new` prefix of a constructor frame', () => {
    const frames = analyzeStack(`Error: boom\n    at new ProductService (${__filename}:3:1)`);
    expect(frames?.[0]?.function).toBe('ProductService');
  });

  it('strips the `[as alias]` suffix V8 adds to an aliased method', () => {
    const frames = analyzeStack(`Error: boom\n    at Repo.save [as create] (${__filename}:3:1)`);
    expect(frames?.[0]?.function).toBe('Repo.save');
  });

  it('resolves a `file://` frame, the shape V8 reports for an ESM module', () => {
    const frames = analyzeStack(
      `Error: boom\n    at ProductService.create (${pathToFileURL(__filename).href}:3:1)`,
      WITH_SOURCE,
    );

    expect(frames?.[0]?.isApplication).toBe(true);
    expect(frames?.[0]?.file).toBe('src/utils/source-context.util.spec.ts');
    expect(frames?.[0]?.absoluteFile).toBe(__filename);
    expect(frames?.[0]?.lines?.length).toBeGreaterThan(0);
  });

  it('leaves a frame with no named function unnamed', () => {
    const frames = analyzeStack(`Error: boom\n    at ${__filename}:3:1`);
    expect(frames?.[0]?.function).toBeUndefined();
  });
});

describe('analyzeStack — hardening against an untrusted stack', () => {
  it('returns quickly on a line crafted to backtrack a naive frame pattern', () => {
    const start = performance.now();
    expect(analyzeStack(`at ${' '.repeat(50_000)}`)).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('reads nothing from a frame forged to escape the project root', () => {
    const escaping = `${process.cwd()}${sep}..${sep}..${sep}etc${sep}passwd.ts`;
    const frames = analyzeStack(`Error: boom\n    at evil (${escaping}:1:1)`, WITH_SOURCE);

    expect(frameAt(frames, 'passwd.ts')?.isApplication).toBe(false);
    expect(frameAt(frames, 'passwd.ts')?.lines).toBeUndefined();
  });
});

describe('resolveSourceContextOptions', () => {
  it('enables the defaults when the option is omitted or true', () => {
    expect(resolveSourceContextOptions(undefined)).toEqual({});
    expect(resolveSourceContextOptions(true)).toEqual({});
  });

  it('disables source reading only on an explicit false', () => {
    expect(resolveSourceContextOptions(false)).toBeUndefined();
  });

  it('passes an object through untouched', () => {
    expect(resolveSourceContextOptions({ maxFrames: 1 })).toEqual({ maxFrames: 1 });
  });
});

describe('resolveStackAnalysisOptions', () => {
  it('defaults to reading source, with no explicit project root', () => {
    expect(resolveStackAnalysisOptions({})).toEqual({ sourceContext: {} });
  });

  it('keeps the project root when sourceContext is off', () => {
    expect(resolveStackAnalysisOptions({ sourceContext: false, projectRoot: '/srv/app' })).toEqual({
      projectRoot: '/srv/app',
    });
  });
});
