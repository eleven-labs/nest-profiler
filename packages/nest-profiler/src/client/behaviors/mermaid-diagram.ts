import { MERMAID_SCRIPT_INTEGRITY, MERMAID_SCRIPT_URL } from '../../collectors/schema/mermaid-cdn';

/** The slice of the Mermaid browser API this behaviour uses. */
interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

const DIAGRAM = '[data-mermaid-diagram]';

let loading: Promise<MermaidApi> | undefined;
let renderCount = 0;

/**
 * Injects the pinned, integrity-checked Mermaid script once and resolves with its global.
 * A failed load is forgotten so reopening the diagram retries it.
 */
function loadMermaid(): Promise<MermaidApi> {
  loading ??= new Promise<MermaidApi>((resolve, reject) => {
    if (window.mermaid) {
      resolve(window.mermaid);
      return;
    }
    const script = document.createElement('script');
    script.src = MERMAID_SCRIPT_URL;
    script.integrity = MERMAID_SCRIPT_INTEGRITY;
    script.crossOrigin = 'anonymous';
    script.onload = () =>
      window.mermaid
        ? resolve(window.mermaid)
        : reject(new Error('Mermaid loaded but did not register itself.'));
    script.onerror = () => reject(new Error(`Could not load Mermaid from ${MERMAID_SCRIPT_URL}.`));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

function currentTheme(): string {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

/** On failure, say why and reveal the raw source so the diagram can still be copied. */
function showError(diagram: HTMLElement, output: HTMLElement, error: unknown): void {
  const message = document.createElement('p');
  message.className = 'text-xs text-danger';
  message.textContent = error instanceof Error ? error.message : String(error);
  output.replaceChildren(message);
  diagram.querySelector('[data-mermaid-source]')?.classList.remove('hidden');
  diagram.removeAttribute('data-mermaid-theme');
}

async function render(diagram: HTMLElement): Promise<void> {
  const output = diagram.querySelector<HTMLElement>('[data-mermaid-output]');
  const source = diagram.querySelector('[data-mermaid-source]')?.textContent ?? '';
  if (!output || !source) return;

  const theme = currentTheme();
  // Marked before the async work so a second toggle (or theme flip) doesn't render twice.
  diagram.setAttribute('data-mermaid-theme', theme);
  try {
    const mermaid = await loadMermaid();
    // `strict` escapes labels and disables click bindings; schemas can exceed the default
    // 50 000-character cap, which would otherwise refuse to render large apps.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, maxTextSize: 1e6 });
    renderCount += 1;
    const { svg } = await mermaid.render(`nest-profiler-mermaid-${renderCount}`, source);
    output.innerHTML = svg;
  } catch (error) {
    showError(diagram, output, error);
  }
}

/**
 * Renders `[data-mermaid-diagram]` sections (the Schema panel's ER diagram) the first time
 * they are opened, loading Mermaid on demand, and re-renders them when the theme flips.
 */
export function initMermaidDiagrams(): void {
  // `toggle` does not bubble, so listen in the capture phase.
  document.addEventListener(
    'toggle',
    (event) => {
      const diagram = event.target;
      if (!(diagram instanceof HTMLDetailsElement) || !diagram.matches(DIAGRAM)) return;
      if (diagram.open && !diagram.hasAttribute('data-mermaid-theme')) void render(diagram);
    },
    true,
  );

  new MutationObserver(() => {
    const theme = currentTheme();
    document.querySelectorAll<HTMLElement>(`${DIAGRAM}[data-mermaid-theme]`).forEach((diagram) => {
      if (diagram.getAttribute('data-mermaid-theme') !== theme) void render(diagram);
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
