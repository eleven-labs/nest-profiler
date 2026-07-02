import type { NestProfilerApi } from '../runtime';

/**
 * On submit of the profile-list filter form, disable empty fields so they are
 * dropped from the GET query string. Disabled controls are excluded from native
 * form serialization, and the page reloads on submit so the state is throwaway.
 */
export function initFilters(api: NestProfilerApi): void {
  api.delegate('submit', 'form[data-profiler-filters]', (form) => {
    const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input[name], select[name]',
    );
    fields.forEach((el) => {
      // Unchecked checkboxes already aren't sent, so leave them enabled.
      if (el instanceof HTMLInputElement && el.type === 'checkbox') return;
      if (el.value.trim() === '') el.disabled = true;
    });
  });
}
