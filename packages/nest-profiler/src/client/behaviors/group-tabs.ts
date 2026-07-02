import type { NestProfilerApi } from '../runtime';

function activateTab(groupId: string, target: string): void {
  document.querySelectorAll<HTMLElement>(`[data-group-tab="${groupId}"]`).forEach((tab) => {
    const active = tab.getAttribute('data-panel') === target;
    tab.classList.toggle('border-nest', active);
    tab.classList.toggle('text-nest', active);
    tab.classList.toggle('border-transparent', !active);
    tab.classList.toggle('text-foreground-muted', !active);
  });
  document.querySelectorAll<HTMLElement>(`[data-group-panel="${groupId}"]`).forEach((panel) => {
    panel.classList.toggle('hidden', panel.getAttribute('data-panel') !== target);
  });
}

/**
 * Wires grouped-panel tabs: clicking a `[data-group-tab]` button reveals the
 * matching `[data-group-panel]` within the same group and highlights the tab.
 * The group id is generated per instance by the template and shared via the
 * `data-group-tab` / `data-group-panel` attributes.
 */
export function initGroupTabs(api: NestProfilerApi): void {
  api.delegate('click', '[data-group-tab]', (tab) => {
    const groupId = tab.getAttribute('data-group-tab');
    const target = tab.getAttribute('data-panel');
    if (groupId && target) activateTab(groupId, target);
  });
}
