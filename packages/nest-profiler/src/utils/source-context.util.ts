import { readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

/** Tunables for {@link ProfilerModuleOptions.sourceContext}. */
export interface SourceContextOptions {
  /** Lines shown above and below the frame's own line. Default: `5`. */
  linesOfContext?: number;
  /** Maximum number of application stack frames annotated with a code excerpt. Default: `5`. */
  maxFrames?: number;
}

/** One line of an annotated source excerpt. */
export interface SourceCodeLine {
  number: number;
  code: string;
  /** `true` for the exact line the stack frame points at. */
  isFaultLine: boolean;
}

/** A single application stack frame, annotated with the source lines around it. */
export interface SourceCodeFrame {
  file: string;
  line: number;
  column?: number;
  function?: string;
  lines: SourceCodeLine[];
}

const DEFAULT_LINES_OF_CONTEXT = 5;
const DEFAULT_MAX_FRAMES = 5;

/** Extensions read for a code excerpt. Anything else (`.json`, a native addon…) is skipped. */
const ALLOWED_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.mts', '.cts']);

/** Upper bound on distinct files kept in the read cache (see {@link getFileLines}). */
const MAX_CACHED_FILES = 200;

/** A `line`/`column` component: bounded and unambiguous, so it cannot backtrack. */
const POSITION_RE = /^\d{1,9}$/;

interface RawFrame {
  function?: string;
  file: string;
  line: number;
  column: number;
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

  // `at fn (<location>)` → the function name is everything before the last ` (`; a frame with no
  // named function is `at <location>` and carries no parentheses at all.
  let rest = trimmed.slice(3).trim();
  let fn: string | undefined;
  if (rest.endsWith(')')) {
    const open = rest.lastIndexOf(' (');
    if (open === -1) return undefined;
    fn = rest.slice(0, open);
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

  return { function: fn, file: rest.slice(0, lineSep), line: Number(line), column: Number(column) };
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

/** Whether a frame belongs to application code — never a dependency or a Node internal. */
function isApplicationFrame(frame: RawFrame): boolean {
  if (frame.file.startsWith('node:')) return false;
  if (frame.file.includes('node_modules')) return false;
  if (frame.file.includes('internal/')) return false;
  if (frame.file.includes('<anonymous>') || frame.file.includes('[native code]')) return false;
  return true;
}

/**
 * Whether `file` may be read for a code excerpt: it must resolve **under `process.cwd()`** and
 * carry a recognised source extension. `Error#stack` is not a trusted input — a multi-line error
 * message can inject text that parses like a stack frame — so without this pair of guards,
 * logging a forged string would let a stack trace read an arbitrary file off the host.
 */
function isReadableSourceFile(file: string): string | undefined {
  if (!ALLOWED_EXTENSIONS.has(extname(file).toLowerCase())) return undefined;
  const resolved = resolve(file);
  const root = process.cwd() + sep;
  return resolved.startsWith(root) ? resolved : undefined;
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

function readContextLines(
  fileLines: string[],
  faultLine: number,
  linesOfContext: number,
): SourceCodeLine[] {
  const start = Math.max(1, faultLine - linesOfContext);
  const end = Math.min(fileLines.length, faultLine + linesOfContext);
  const result: SourceCodeLine[] = [];
  for (let number = start; number <= end; number++) {
    result.push({ number, code: fileLines[number - 1] ?? '', isFaultLine: number === faultLine });
  }
  return result;
}

/**
 * Normalizes {@link ProfilerModuleOptions.sourceContext} (`boolean | SourceContextOptions`) into
 * the shape {@link buildSourceContext} takes: `undefined` when off, `{}` for the defaults when
 * `true`, or the object itself.
 */
export function resolveSourceContextOptions(
  option: boolean | SourceContextOptions | undefined,
): SourceContextOptions | undefined {
  if (!option) return undefined;
  return option === true ? {} : option;
}

/**
 * Builds the annotated code frames for an `Error#stack`, or `undefined` when the stack is
 * missing or carries no readable application frame. Never throws: a source excerpt is a nicety,
 * not a requirement, for a request that already failed.
 */
export function buildSourceContext(
  stack: string | undefined,
  options: SourceContextOptions = {},
): SourceCodeFrame[] | undefined {
  if (!stack) return undefined;
  try {
    const linesOfContext = options.linesOfContext ?? DEFAULT_LINES_OF_CONTEXT;
    const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;

    const frames: SourceCodeFrame[] = [];
    for (const raw of parseStackFrames(stack)) {
      if (frames.length >= maxFrames) break;
      if (!isApplicationFrame(raw)) continue;
      const absolutePath = isReadableSourceFile(raw.file);
      if (!absolutePath) continue;
      const fileLines = getFileLines(absolutePath);
      if (!fileLines) continue;

      // A line number past the end of the file yields no excerpt — a forged stack, or a source
      // edited since it was cached. Skip the frame rather than render an empty code block.
      const lines = readContextLines(fileLines, raw.line, linesOfContext);
      if (lines.length === 0) continue;

      frames.push({
        file: raw.file,
        line: raw.line,
        column: raw.column,
        function: raw.function,
        lines,
      });
    }
    return frames.length > 0 ? frames : undefined;
  } catch {
    return undefined;
  }
}
