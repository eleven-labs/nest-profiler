import type { NestProfilerApi } from '../runtime';

// The payload is base64-encoded (UTF-8) into `data-copy` by the `copyBtn` server
// helper so any text (multi-line, quotes, unicode) survives without HTML-escaping.
function decodeBase64Utf8(b64: string): string {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    // Malformed base64 (InvalidCharacterError) — copy nothing rather than throwing.
    return '';
  }
}

function flash(button: HTMLElement): void {
  const label = button.querySelector<HTMLElement>('[data-copy-text]');
  if (!label) return;
  const original = button.getAttribute('data-copy-label') ?? 'Copy';
  label.textContent = 'Copied!';
  setTimeout(() => {
    label.textContent = original;
  }, 1500);
}

/**
 * Wires `[data-copy]` buttons to copy their decoded payload and flash "Copied!".
 * Stops propagation so a button nested in an expandable row never toggles it.
 */
export function initCopy(api: NestProfilerApi): void {
  api.delegate('click', '[data-copy]', (button, event) => {
    event.stopPropagation();
    const text = decodeBase64Utf8(button.getAttribute('data-copy') ?? '');
    void api.copyText(text).then((ok) => {
      if (ok) flash(button);
    });
  });
}
