/**
 * @jest-environment jsdom
 */
import { TextDecoder } from 'node:util';
import { initCopy } from './behaviors/copy';
import { initFilters } from './behaviors/filters';
import { initGroupTabs } from './behaviors/group-tabs';
import { bootTheme, initTheme } from './behaviors/theme';
import { createRuntime } from './runtime';

// jsdom does not expose TextDecoder; the client uses it to decode copy payloads.
// Node's and the DOM's TextDecoder signatures differ slightly, hence the cast.
globalThis.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;

const api = createRuntime();

// Behaviours attach delegated listeners on `document`; register each once so the
// listener set is stable across tests, then drive them by mutating the DOM.
beforeAll(() => {
  initTheme(api);
  initCopy(api);
  initFilters(api);
  initGroupTabs(api);
});

beforeEach(() => {
  document.documentElement.className = '';
  document.body.innerHTML = '';
  localStorage.clear();
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('runtime.onReady', () => {
  it('runs immediately when the document is already parsed', () => {
    const spy = jest.fn();
    api.onReady(spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('theme behaviour', () => {
  it('bootTheme applies the persisted dark theme and disables the light hljs sheet', () => {
    localStorage.setItem('profiler-theme', 'dark');
    document.head.innerHTML =
      '<link id="hljs-light" rel="stylesheet"><link id="hljs-dark" rel="stylesheet">';

    bootTheme();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect((document.getElementById('hljs-light') as HTMLLinkElement).disabled).toBe(true);
  });

  it('toggles dark mode and persists the choice on click', () => {
    document.body.innerHTML = '<button data-action="toggle-theme">theme</button>';
    const button = document.querySelector('button');

    button?.click();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('profiler-theme')).toBe('dark');

    button?.click();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('profiler-theme')).toBe('light');
  });
});

describe('copy behaviour', () => {
  it('decodes the base64 payload, copies it, and flashes "Copied!"', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const payload = Buffer.from('hello world', 'utf8').toString('base64');
    document.body.innerHTML = `<button data-copy="${payload}" data-copy-label="Copy"><span data-copy-text>Copy</span></button>`;
    const button = document.querySelector('button');
    const label = document.querySelector('[data-copy-text]');

    button?.click();
    await flush();

    expect(writeText).toHaveBeenCalledWith('hello world');
    expect(label?.textContent).toBe('Copied!');
  });
});

describe('filters behaviour', () => {
  it('disables empty text/select fields but leaves filled fields and checkboxes on submit', () => {
    document.body.innerHTML =
      '<form data-profiler-filters>' +
      '<input name="empty" value="" />' +
      '<input name="filled" value="x" />' +
      '<input name="flag" type="checkbox" />' +
      '</form>';
    const form = document.querySelector('form');

    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const field = (name: string): HTMLInputElement =>
      document.querySelector(`[name="${name}"]`) as HTMLInputElement;
    expect(field('empty').disabled).toBe(true);
    expect(field('filled').disabled).toBe(false);
    expect(field('flag').disabled).toBe(false);
  });
});

describe('group-tabs behaviour', () => {
  it('reveals the clicked panel and hides the others within the group', () => {
    document.body.innerHTML =
      '<button data-group-tab="g1" data-panel="a">A</button>' +
      '<button data-group-tab="g1" data-panel="b">B</button>' +
      '<div data-group-panel="g1" data-panel="a">PA</div>' +
      '<div data-group-panel="g1" data-panel="b" class="hidden">PB</div>';

    const tabB = document.querySelector('[data-group-tab="g1"][data-panel="b"]') as HTMLElement;
    tabB.click();

    const panelA = document.querySelector('[data-group-panel="g1"][data-panel="a"]') as HTMLElement;
    const panelB = document.querySelector('[data-group-panel="g1"][data-panel="b"]') as HTMLElement;
    expect(panelA.classList.contains('hidden')).toBe(true);
    expect(panelB.classList.contains('hidden')).toBe(false);
    expect(tabB.classList.contains('text-nest')).toBe(true);
  });
});
