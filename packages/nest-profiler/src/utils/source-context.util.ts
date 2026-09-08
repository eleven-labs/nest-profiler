import { readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Tunables for {@link ProfilerModuleOptions.sourceContext} — the source excerpts, not the frames. */
export interface SourceContextOptions {
  /** Lines shown above and below the frame's own line. Default: `5`. */
  linesOfContext?: number;
  /** Maximum number of application frames annotated with a code excerpt. Default: `5`. */
  maxFrames?: number;
}

/** One line of an annotated source excerpt. */
export interface SourceCodeLine {
  number: number;
  code: string;
  /** `true` for the exact line the stack frame points at. */
  isFaultLine: boolean;
}

/**
 * One parsed `Error#stack` frame — application code, a dependency or a Node internal alike.
 *
 * The whole stack is kept, not only the application part: the UI needs the dependency frames to
 * group and count them, and dropping them left the raw stack string as the only way to see what
 * a query builder was doing when it threw.
 */
export interface SourceCodeFrame {
  /**
   * Display path: relative to the project root for an application frame, relative to its package
   * root for a dependency (`typeorm/query-runner/PostgresQueryRunner.js`), and untouched for
   * anything else (`node:internal/process/task_queues`).
   */
  file: string;
  /**
   * Absolute path, set only for an application frame that resolved under the project root — the
   * one form an editor link can open. Absent for everything else, which is also what makes it
   * safe to hand to a URL.
   */
  absoluteFile?: string;
  /** 1-based line the frame points at. */
  line: number;
  /** 1-based column, when the stack carried one. */
  column?: number;
  /** Function or `Class.method` name, without V8's `async`, `new` and `[as alias]` decorations. */
  function?: string;
  /** `true` for a frame resumed from an `await` (V8 prints those as `at async Class.method`). */
  isAsync?: boolean;
  /** `true` when the frame is the application's own code rather than a dependency or Node itself. */
  isApplication: boolean;
  /**
   * Source excerpt around {@link line}. Application frames only, and only while
   * {@link ProfilerModuleOptions.sourceContext} is on and the frame is within its `maxFrames`.
   */
  lines?: SourceCodeLine[];
}

/** Settings {@link analyzeStack} reads. */
export interface StackAnalysisOptions {
  /** Root the excerpt reader is confined to, and display paths are relative to. Default: `process.cwd()`. */
  projectRoot?: string;
  /** Excerpt settings, or `undefined` to keep the frames without reading any source. */
  sourceContext?: SourceContextOptions;
}

const DEFAULT_LINES_OF_CONTEXT = 5;
const DEFAULT_MAX_FRAMES = 5;

/** Upper bound on frames kept per exception — deep enough for any real stack, bounded for storage. */
const MAX_STACK_FRAMES = 50;

/** Extensions read for a code excerpt. Anything else (`.json`, a native addon…) is skipped. */
const ALLOWED_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.mts', '.cts']);

/** Upper bound on distinct files kept in the read cache (see {@link getFileLines}). */
const MAX_CACHED_FILES = 200;

/** A `line`/`column` component: bounded and unambiguous, so it cannot backtrack. */
const POSITION_RE = /^\d{1,9}$/;

const NODE_MODULES_SEGMENT = `${sep}node_modules${sep}`;

interface RawFrame {
  function?: string;
  isAsync: boolean;
  file: string;
  line: number;
  column: number;
}

/** Strips V8's `new ` prefix and ` [as alias]` suffix off a frame's function name. */
function cleanFunctionName(name: string): string | undefined {
  let cleaned = name.startsWith('new ') ? name.slice(4) : name;
  const alias = cleaned.indexOf(' [as ');
  if (alias !== -1) cleaned = cleaned.slice(0, alias);
  cleaned = cleaned.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Parses one `Error#stack` line — `at fn (/path/file.ts:10:5)` or `at /path/file.ts:10:5` — or
 * returns `undefined` for anything else (the leading `Error: message` line included).
 *
 * Split by hand rather than matched by one regex: a stack is not a trusted input (an error
 * message interpolates user data and a multi-line one puts attacker-chosen text where a frame is
 * expected), and a pattern shaped like `at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)` backtracks
 * polynomially on a line of `at ` followed by many spaces. Scanning from the right for the two
 * `:` separators is linear and has nothing to backtrack.
 */
function parseStackFrame(rawLine: string): RawFrame | undefined {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith('at ')) return undefined;

  let rest = trimmed.slice(3).trim();

  // `async` prefixes the frame, not the function: stripping it first keeps it out of both the
  // function name and — on an `at async /path:1:1` frame — the file.
  let isAsync = false;
  if (rest.startsWith('async ')) {
    isAsync = true;
    rest = rest.slice(6).trim();
  }

  // `at fn (<location>)` → the function name is everything before the last ` (`; a frame with no
  // named function is `at <location>` and carries no parentheses at all.
  let fn: string | undefined;
  if (rest.endsWith(')')) {
    const open = rest.lastIndexOf(' (');
    if (open === -1) return undefined;
    fn = cleanFunctionName(rest.slice(0, open));
    rest = rest.slice(open + 2, -1);
  }

  // `<file>:<line>:<column>`, read from the right so a Windows drive letter or a `node:` prefix
  // stays part of the file rather than being mistaken for a separator.
  const columnSep = rest.lastIndexOf(':');
  if (columnSep <= 0) return undefined;
  const lineSep = rest.lastIndexOf(':', columnSep - 1);
  if (lineSep <= 0) return undefined;

  const line = rest.slice(lineSep + 1, columnSep);
  const column = rest.slice(columnSep + 1);
  if (!POSITION_RE.test(line) || !POSITION_RE.test(column)) return undefined;

  return {
    function: fn,
    isAsync,
    file: toFilePath(rest.slice(0, lineSep)),
    line: Number(line),
    column: Number(column),
  };
}

/**
 * A frame's file as a filesystem path. V8 reports an ESM module's frames as `file://` URLs, which
 * resolve to nothing and would leave every frame of an ESM application unreadable and unlinkable.
 */
function toFilePath(file: string): string {
  if (!file.startsWith('file://')) return file;
  try {
    return fileURLToPath(file);
  } catch {
    return file;
  }
}

/** Parses `Error#stack` into frames, skipping every line that is not one. */
function parseStackFrames(stack: string): RawFrame[] {
  const frames: RawFrame[] = [];
  for (const rawLine of stack.split('\n')) {
    const frame = parseStackFrame(rawLine);
    if (frame) frames.push(frame);
  }
  return frames;
}

/** Native separators to `/`, so a display path reads the same on every platform. */
function toDisplayPath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * A dependency frame's path, relative to its own package root: the last `node_modules/` wins, so
 * a pnpm store path (`node_modules/.pnpm/typeorm@0.3.27/node_modules/typeorm/…`) and a nested npm
 * install both come out as `typeorm/…`.
 */
function toPackageRelativePath(file: string): string {
  const marker = file.lastIndexOf(NODE_MODULES_SEGMENT);
  return marker === -1 ? file : file.slice(marker + NODE_MODULES_SEGMENT.length);
}

interface ClassifiedFrame {
  isApplication: boolean;
  file: string;
  absoluteFile?: string;
}

/**
 * Places a frame's file: the application's own source, a dependency, or neither (a Node internal,
 * an `eval`, a path outside the project root).
 *
 * "Application" means **resolving under the project root** rather than merely not looking like a
 * dependency, which is also the guard that keeps the excerpt reader inside the project: only a
 * frame classified here as application is ever read off disk.
 */
function classifyFrame(file: string, projectRoot: string): ClassifiedFrame {
  if (file.startsWith('node:')) return { isApplication: false, file };
  if (file.includes(NODE_MODULES_SEGMENT)) {
    return { isApplication: false, file: toDisplayPath(toPackageRelativePath(file)) };
  }
  // `<anonymous>`, `[native code]`, `eval at …` and pre-`node:` internals such as
  // `internal/process/task_queues` — nothing that can be resolved, let alone read.
  if (!isAbsolute(file)) return { isApplication: false, file };

  const absoluteFile = resolve(file);
  const root = resolve(projectRoot) + sep;
  if (!absoluteFile.startsWith(root)) return { isApplication: false, file: toDisplayPath(file) };

  return {
    isApplication: true,
    file: toDisplayPath(relative(resolve(projectRoot), absoluteFile)),
    absoluteFile,
  };
}

/** Read-through cache of file contents (split into lines), failures cached as `null` too. */
const fileLinesCache = new Map<string, string[] | null>();

function getFileLines(absolutePath: string): string[] | undefined {
  const cached = fileLinesCache.get(absolutePath);
  if (cached !== undefined) return cached ?? undefined;

  let lines: string[] | null;
  try {
    lines = readFileSync(absolutePath, 'utf8').split('\n');
  } catch {
    lines = null;
  }

  if (fileLinesCache.size < MAX_CACHED_FILES) {
    fileLinesCache.set(absolutePath, lines);
  }
  return lines ?? undefined;
}

/**
 * The excerpt around `faultLine`, or `undefined` when the file cannot be read or the line falls
 * past its end — a forged stack, or a source edited since the build.
 */
function readExcerpt(
  absolutePath: string,
  faultLine: number,
  linesOfContext: number,
): SourceCodeLine[] | undefined {
  if (!ALLOWED_EXTENSIONS.has(extname(absolutePath).toLowerCase())) return undefined;

  const fileLines = getFileLines(absolutePath);
  if (!fileLines || faultLine > fileLines.length) return undefined;

  const start = Math.max(1, faultLine - linesOfContext);
  const end = Math.min(fileLines.length, faultLine + linesOfContext);
  const excerpt: SourceCodeLine[] = [];
  for (let number = start; number <= end; number++) {
    excerpt.push({ number, code: fileLines[number - 1] ?? '', isFaultLine: number === faultLine });
  }
  return excerpt.length > 0 ? excerpt : undefined;
}

/**
 * Normalizes {@link ProfilerModuleOptions.sourceContext} (`boolean | SourceContextOptions`) into
 * the shape {@link analyzeStack} takes: `undefined` when explicitly off, `{}` for the defaults
 * when omitted or `true`, or the object itself.
 */
export function resolveSourceContextOptions(
  option: boolean | SourceContextOptions | undefined,
): SourceContextOptions | undefined {
  if (option === false) return undefined;
  return option === undefined || option === true ? {} : option;
}

/**
 * Resolves the two module options {@link analyzeStack} reads into the shape it takes, so every
 * capture site — the interceptor, the catch-all filter, `TracerService.captureError`, a package
 * building its own profile — annotates its exceptions on one setting.
 */
export function resolveStackAnalysisOptions(options: {
  projectRoot?: string;
  sourceContext?: boolean | SourceContextOptions;
}): StackAnalysisOptions {
  const sourceContext = resolveSourceContextOptions(options.sourceContext);
  return {
    ...(options.projectRoot !== undefined ? { projectRoot: options.projectRoot } : {}),
    ...(sourceContext !== undefined ? { sourceContext } : {}),
  };
}

/**
 * Turns an `Error#stack` into {@link SourceCodeFrame}s, annotating the application ones with a
 * source excerpt when `sourceContext` is on.
 *
 * Parsing costs no I/O and always runs: a grouped, per-frame stack is strictly better than the
 * raw string it replaces. Reading source off disk is what `sourceContext` gates, and it happens
 * only for frames under the project root with an executable extension — `Error#stack` can carry
 * attacker-influenced text, so without those two guards logging a forged string would let a
 * stack trace read an arbitrary file off the host.
 *
 * Never throws: a stack view is a nicety, not a requirement, for a request that already failed.
 */
export function analyzeStack(
  stack: string | undefined,
  options: StackAnalysisOptions = {},
): SourceCodeFrame[] | undefined {
  if (!stack) return undefined;
  try {
    const projectRoot = options.projectRoot ?? process.cwd();
    const { sourceContext } = options;
    const linesOfContext = sourceContext?.linesOfContext ?? DEFAULT_LINES_OF_CONTEXT;
    const maxFrames = sourceContext?.maxFrames ?? DEFAULT_MAX_FRAMES;

    const frames: SourceCodeFrame[] = [];
    let excerpts = 0;

    for (const raw of parseStackFrames(stack)) {
      if (frames.length >= MAX_STACK_FRAMES) break;
      const placed = classifyFrame(raw.file, projectRoot);

      const frame: SourceCodeFrame = {
        file: placed.file,
        ...(placed.absoluteFile !== undefined ? { absoluteFile: placed.absoluteFile } : {}),
        line: raw.line,
        column: raw.column,
        ...(raw.function !== undefined ? { function: raw.function } : {}),
        ...(raw.isAsync ? { isAsync: true } : {}),
        isApplication: placed.isApplication,
      };

      if (sourceContext && placed.absoluteFile && excerpts < maxFrames) {
        const excerpt = readExcerpt(placed.absoluteFile, raw.line, linesOfContext);
        if (excerpt) {
          frame.lines = excerpt;
          excerpts++;
        }
      }

      frames.push(frame);
    }

    return frames.length > 0 ? frames : undefined;
  } catch {
    return undefined;
  }
}
