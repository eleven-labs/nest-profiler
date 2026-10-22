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
      <div data-mermaid-output><p>Loading diagram…</p></div>
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

const injectedScripts = (): HTMLScriptElement[] =>
  Array.from(document.head.querySelectorAll<HTMLScriptElement>('script'));

// The loader memoises the first successfully loaded instance, so every test shares this stub.
const mermaid = {
  initialize: jest.fn(),
  render: jest.fn().mockResolvedValue({ svg: '<svg data-testid="er"></svg>' }),
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

    expect(output().textContent).toContain('Could not load Mermaid');
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

  it('shows the parse error and reveals the source when Mermaid rejects it', async () => {
    mermaid.render.mockRejectedValueOnce(new Error('Parse error on line 2'));
    await open(mountDiagram());
    await flush();

    expect(output().textContent).toBe('Parse error on line 2');
    expect(document.querySelector('[data-mermaid-source]')?.classList.contains('hidden')).toBe(
      false,
    );
  });
});
