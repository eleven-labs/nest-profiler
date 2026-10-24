import { MERMAID_SCRIPT_INTEGRITY, MERMAID_SCRIPT_URL } from '../../collectors/schema/mermaid-cdn';
import { focusDiagramElement, mountDiagramViewport } from './diagram-viewport';

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
const ENTITY_PICKER = '[data-mermaid-entities]';
/** Mermaid ids each entity's group `<renderId>-entity-<name>-<index>`. */
const ENTITY_ID = /-entity-(.+)-\d+$/;

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
function showError(diagram: HTMLElement, status: HTMLElement, error: unknown): void {
  const message = document.createElement('p');
  message.className = 'text-xs text-danger';
  message.textContent = error instanceof Error ? error.message : String(error);
  status.replaceChildren(message);
  status.classList.remove('hidden');
  diagram.querySelector('[data-diagram-viewport]')?.classList.add('hidden');
  diagram.querySelector('[data-mermaid-source]')?.classList.remove('hidden');
  diagram.removeAttribute('data-mermaid-theme');
}

/** The entity groups Mermaid drew, by name — empty if its id scheme ever changes. */
function entityNodes(svg: Element): Array<{ name: string; node: Element }> {
  return Array.from(svg.querySelectorAll('g.node[id]'))
    .map((node) => ({ name: ENTITY_ID.exec(node.id)?.[1] ?? '', node }))
    .filter((entity) => entity.name !== '')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Lists the drawn entities in the "Go to entity" picker, hidden when none could be found. */
function fillEntityPicker(diagram: HTMLElement, svg: Element): void {
  const picker = diagram.querySelector<HTMLSelectElement>(ENTITY_PICKER);
  if (!picker) return;
  const entities = entityNodes(svg);
  const placeholder = picker.options[0];
  picker.replaceChildren(
    ...(placeholder ? [placeholder] : []),
    ...entities.map(({ name, node }) => new Option(name, node.id)),
  );
  picker.value = '';
  picker.closest('[data-diagram-controls]')?.classList.toggle('hidden', entities.length === 0);
}

/** Centres and highlights the entity picked in the "Go to entity" list. */
function focusEntity(picker: HTMLSelectElement): void {
  const viewport = picker.closest<HTMLElement>('[data-diagram-viewport]');
  const svg = viewport?.querySelector('[data-mermaid-output] svg');
  if (!viewport || !svg) return;
  svg.querySelector('[data-diagram-focused]')?.removeAttribute('data-diagram-focused');
  const node = Array.from(svg.querySelectorAll('g.node[id]')).find(({ id }) => id === picker.value);
  if (!node) return;
  node.setAttribute('data-diagram-focused', '');
  focusDiagramElement(viewport, node);
}

async function render(diagram: HTMLElement): Promise<void> {
  const status = diagram.querySelector<HTMLElement>('[data-mermaid-status]');
  const viewport = diagram.querySelector<HTMLElement>('[data-diagram-viewport]');
  const output = viewport?.querySelector<HTMLElement>('[data-mermaid-output]');
  const source = diagram.querySelector('[data-mermaid-source]')?.textContent ?? '';
  if (!status || !viewport || !output || !source) return;

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
    const element = output.querySelector('svg');
    if (!element) throw new Error('Mermaid returned no diagram.');
    // Shown before mounting: the viewport measures itself to frame the diagram.
    status.classList.add('hidden');
    viewport.classList.remove('hidden');
    mountDiagramViewport(viewport, element);
    fillEntityPicker(diagram, element);
  } catch (error) {
    showError(diagram, status, error);
  }
}

/**
 * Renders `[data-mermaid-diagram]` sections (the Schema panel's ER diagram) the first time
 * they are opened, loading Mermaid on demand, and re-renders them when the theme flips. The
 * diagram is drawn into a pannable, zoomable viewport (see `diagram-viewport.ts`).
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

  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement && event.target.matches(ENTITY_PICKER)) {
      focusEntity(event.target);
    }
  });

  new MutationObserver(() => {
    const theme = currentTheme();
    document.querySelectorAll<HTMLElement>(`${DIAGRAM}[data-mermaid-theme]`).forEach((diagram) => {
      if (diagram.getAttribute('data-mermaid-theme') !== theme) void render(diagram);
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
