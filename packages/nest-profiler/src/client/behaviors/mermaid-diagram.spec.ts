/**
 * @jest-environment jsdom
 */
import { MERMAID_SCRIPT_INTEGRITY, MERMAID_SCRIPT_URL } from '../../collectors/schema/mermaid-cdn';
import { initMermaidDiagrams } from './mermaid-diagram';

const SOURCE = 'erDiagram\n  Product {\n    int id PK\n  }';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Mirrors the markup `schema-panel.ejs` emits for the diagram section. */
function mountDiagram(): HTMLDetailsElement {
  document.body.innerHTML = `
    <details data-mermaid-diagram>
      <summary>Entity relationship diagram</summary>
      <div data-mermaid-status><p>Loading diagram…</p></div>
      <div class="hidden" data-diagram-viewport>
        <div data-mermaid-output></div>
        <div class="hidden" data-diagram-controls>
          <select data-mermaid-entities><option value="">Go to entity…</option></select>
        </div>
        <button data-diagram-action="zoom-in"></button>
        <span data-diagram-zoom></span>
      </div>
      <pre class="hidden" data-mermaid-source>${SOURCE}</pre>
    </details>`;
  return document.querySelector('details') as HTMLDetailsElement;
}

/** Opens the section; jsdom fires the (non-bubbling) `toggle` event as a queued task. */
async function open(details: HTMLDetailsElement): Promise<void> {
  details.open = true;
  await flush();
}

const output = (): HTMLElement => document.querySelector('[data-mermaid-output]') as HTMLElement;
const status = (): HTMLElement => document.querySelector('[data-mermaid-status]') as HTMLElement;
const viewport = (): HTMLElement =>
  document.querySelector('[data-diagram-viewport]') as HTMLElement;
const picker = (): HTMLSelectElement =>
  document.querySelector('[data-mermaid-entities]') as HTMLSelectElement;

const SVG =
  '<svg viewBox="0 0 400 300">' +
  '<g class="node" id="nest-profiler-mermaid-1-entity-User-0"></g>' +
  '<g class="node" id="nest-profiler-mermaid-1-entity-Product-1"></g>' +
  '</svg>';

const injectedScripts = (): HTMLScriptElement[] =>
  Array.from(document.head.querySelectorAll<HTMLScriptElement>('script'));

// The loader memoises the first successfully loaded instance, so every test shares this stub.
const mermaid = {
  initialize: jest.fn(),
  render: jest.fn().mockResolvedValue({ svg: SVG }),
};

beforeAll(() => initMermaidDiagrams());

beforeEach(() => {
  document.documentElement.className = '';
  document.head.innerHTML = '';
  delete window.mermaid;
});

// Ordered: the loader memoises a successful load, so the failure path runs first.
describe('mermaid-diagram behaviour', () => {
  it('does not load Mermaid until the diagram is opened', () => {
    mountDiagram();
    expect(injectedScripts()).toHaveLength(0);
  });

  it('injects the pinned, integrity-checked script and reports a failed load', async () => {
    const details = mountDiagram();
    await open(details);

    const [script] = injectedScripts();
    expect(script?.src).toBe(MERMAID_SCRIPT_URL);
    expect(script?.integrity).toBe(MERMAID_SCRIPT_INTEGRITY);
    expect(script?.crossOrigin).toBe('anonymous');

    script?.onerror?.(new Event('error'));
    await flush();

    expect(status().textContent).toContain('Could not load Mermaid');
    expect(viewport().classList.contains('hidden')).toBe(true);
    expect(document.querySelector('[data-mermaid-source]')?.classList.contains('hidden')).toBe(
      false,
    );
  });

  it('renders the source once loaded, with strict security and the current theme', async () => {
    const { initialize, render } = mermaid;
    const details = mountDiagram();
    await open(details);

    // The previous failure was forgotten, so opening retries the load.
    const [script] = injectedScripts();
    window.mermaid = mermaid;
    script?.onload?.(new Event('load'));
    await flush();

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', theme: 'default' }),
    );
    expect(render).toHaveBeenCalledWith(expect.any(String), SOURCE);
    expect(output().querySelector('svg')).not.toBeNull();
    expect(status().classList.contains('hidden')).toBe(true);
    expect(viewport().classList.contains('hidden')).toBe(false);

    // Reopening does not render again; flipping the theme does.
    details.open = false;
    await flush();
    await open(details);
    expect(render).toHaveBeenCalledTimes(1);

    document.documentElement.classList.add('dark');
    await flush();
    expect(render).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  it('lists the drawn entities in the picker and highlights the one picked', async () => {
    await open(mountDiagram());
    await flush();

    expect(Array.from(picker().options, (option) => option.text)).toEqual([
      'Go to entity…',
      'Product',
      'User',
    ]);
    expect(picker().closest('[data-diagram-controls]')?.classList.contains('hidden')).toBe(false);

    picker().value = 'nest-profiler-mermaid-1-entity-User-0';
    picker().dispatchEvent(new Event('change', { bubbles: true }));
    const focused = output().querySelectorAll('[data-diagram-focused]');
    expect(Array.from(focused, (node) => node.id)).toEqual([picker().value]);
  });

  it('shows the parse error and reveals the source when Mermaid rejects it', async () => {
    mermaid.render.mockRejectedValueOnce(new Error('Parse error on line 2'));
    await open(mountDiagram());
    await flush();

    expect(status().textContent).toBe('Parse error on line 2');
    expect(document.querySelector('[data-mermaid-source]')?.classList.contains('hidden')).toBe(
      false,
    );
  });
});
