import type { NestProfilerApi } from '../runtime';

const STORAGE_KEY = 'profiler-theme';

function prefersDark(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark';
  } catch {
    return false;
  }
}

function setDisabled(id: string, disabled: boolean): void {
  const link = document.getElementById(id);
  if (link instanceof HTMLLinkElement) link.disabled = disabled;
}

/**
 * Applies the persisted theme before first paint to avoid a flash of the wrong
 * theme. Called synchronously at script load (blocking `<script>` in `<head>`).
 */
export function bootTheme(): void {
  const isDark = prefersDark();
  if (isDark) document.documentElement.classList.add('dark');
  setDisabled(isDark ? 'hljs-light' : 'hljs-dark', true);
}

function toggleTheme(): void {
  const isDark = document.documentElement.classList.toggle('dark');
  try {
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
  } catch {
    // storage may be unavailable (private mode); the in-memory toggle still works
  }
  setDisabled('hljs-light', isDark);
  setDisabled('hljs-dark', !isDark);
}

/** Wires `[data-action="toggle-theme"]` controls to flip light/dark mode. */
export function initTheme(api: NestProfilerApi): void {
  api.delegate('click', '[data-action="toggle-theme"]', () => toggleTheme());
}
