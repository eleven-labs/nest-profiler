// The profiler client runtime. Bundled by esbuild into `dist/public/scripts/profiler.js`
// and exposed on `window.NestProfiler` so extension bundles (each package can ship
// its own) reuse these helpers instead of re-implementing DOM plumbing. The global
// object is the ONLY cross-bundle contract — bundles never import each other.

/** Shared browser API other profiler bundles consume via `window.NestProfiler`. */
export interface NestProfilerApi {
  /** Run `fn` once the DOM is ready (immediately if it already is). */
  onReady(fn: () => void): void;
  /** Attach a delegated `event` listener on `document` for elements matching `selector`. */
  delegate<E extends keyof DocumentEventMap>(
    event: E,
    selector: string,
    handler: (element: HTMLElement, event: DocumentEventMap[E]) => void,
  ): void;
  /** Copy `text` to the clipboard, falling back to a hidden textarea. Resolves to success. */
  copyText(text: string): Promise<boolean>;
  /** Run highlight.js over `root` (or the whole document when omitted). */
  highlight(root?: ParentNode): void;
}

interface HighlightJs {
  highlightAll(): void;
  highlightElement(element: HTMLElement): void;
}

declare global {
  interface Window {
    NestProfiler: NestProfilerApi;
    hljs?: HighlightJs;
  }
}

function onReady(fn: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function delegate<E extends keyof DocumentEventMap>(
  event: E,
  selector: string,
  handler: (element: HTMLElement, event: DocumentEventMap[E]) => void,
): void {
  document.addEventListener(event, (ev) => {
    const target = ev.target instanceof Element ? ev.target : null;
    const element = target?.closest<HTMLElement>(selector);
    if (element) handler(element, ev);
  });
}

// Fallback for insecure contexts where `navigator.clipboard` is unavailable
// (non-https, non-localhost): write via a hidden textarea + `execCommand`.
function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the textarea fallback
    }
  }
  return fallbackCopy(text);
}

function highlight(root?: ParentNode): void {
  const hljs = window.hljs;
  if (!hljs) return;
  if (root) {
    root.querySelectorAll<HTMLElement>('pre code').forEach((el) => hljs.highlightElement(el));
  } else {
    hljs.highlightAll();
  }
}

/** Build the runtime API object assigned to `window.NestProfiler`. */
export function createRuntime(): NestProfilerApi {
  return { onReady, delegate, copyText, highlight };
}
