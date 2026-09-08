import { resolveRedactionConfig } from './redaction-config';
import { redact, REDACTED } from './redact.utils';

describe('resolveRedactionConfig', () => {
  it('merges the built-in header list with both the unified block and the deprecated option', () => {
    const config = resolveRedactionConfig({
      maskHeaders: ['x-legacy'],
      redaction: { headers: ['X-Trace'] },
    });

    expect(config.maskHeaders.has('authorization')).toBe(true);
    expect(config.maskHeaders.has('x-legacy')).toBe(true);
    // Lower-cased on the way in, so a mixed-case entry still matches a captured header name.
    expect(config.maskHeaders.has('x-trace')).toBe(true);
  });

  it('drops the built-in lists when either opt-out flag says so', () => {
    expect(resolveRedactionConfig({ redaction: { useDefaults: false } }).maskHeaders.size).toBe(0);
    expect(resolveRedactionConfig({ useDefaultMaskHeaders: false }).maskHeaders.size).toBe(0);
    expect(resolveRedactionConfig({ useDefaultMaskQueryParams: false }).maskQueryParams.size).toBe(
      0,
    );
  });

  it('keeps the built-ins off when one surface opts out and the other still says true', () => {
    // The safety net only ever narrows on an explicit opt-out — it must not come back on
    // because the deprecated flag, left at its default, still reads `true`.
    const config = resolveRedactionConfig({
      useDefaultMaskHeaders: true,
      redaction: { useDefaults: false },
    });
    expect(config.maskHeaders.size).toBe(0);
  });

  it('merges cookie names from both surfaces', () => {
    const config = resolveRedactionConfig({
      maskCookies: ['old'],
      redaction: { cookies: ['new'] },
    });
    expect([...config.maskCookies].sort()).toEqual(['new', 'old']);
  });

  it('builds redact options carrying the configured keys, patterns and replacement', () => {
    const config = resolveRedactionConfig({
      redaction: { keys: ['tenantRef'], patterns: [/acct_\d{4}/g], replacement: '***' },
    });

    expect(config.replacement).toBe('***');
    expect(redact({ tenantRef: 'a', note: 'acct_1234' }, config.redactOptions)).toEqual({
      tenantRef: '***',
      note: '***',
    });
  });

  it('drops the built-in sensitive-key pattern under useDefaults: false, keeping only named keys', () => {
    const config = resolveRedactionConfig({
      redaction: { useDefaults: false, keys: ['tenantRef'] },
    });

    expect(redact({ password: 'hunter2', tenantRef: 'acme' }, config.redactOptions)).toEqual({
      password: 'hunter2',
      tenantRef: REDACTED,
    });
  });

  it('keeps the built-in value detectors under useDefaults: false — they are not a list to restate', () => {
    const config = resolveRedactionConfig({ redaction: { useDefaults: false } });
    expect(redact({ note: 'sk-ABCDEFGHIJKLMNOPQRST' }, config.redactOptions)).toEqual({
      note: REDACTED,
    });
  });
});
