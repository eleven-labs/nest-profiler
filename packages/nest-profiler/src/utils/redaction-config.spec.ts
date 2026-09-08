import { resolveRedactionConfig } from './redaction-config';
import { redact, REDACTED } from './redact.utils';

describe('resolveRedactionConfig', () => {
  it('extends the built-in header list rather than replacing it', () => {
    const config = resolveRedactionConfig({ redaction: { headers: ['X-Trace'] } });

    expect(config.maskHeaders.has('authorization')).toBe(true);
    // Lower-cased on the way in, so a mixed-case entry still matches a captured header name.
    expect(config.maskHeaders.has('x-trace')).toBe(true);
  });

  it('drops every built-in list at once under useDefaults: false', () => {
    const config = resolveRedactionConfig({ redaction: { useDefaults: false } });

    expect(config.maskHeaders.size).toBe(0);
    expect(config.maskQueryParams.size).toBe(0);
  });

  it('keeps the names spelled out under useDefaults: false', () => {
    // Opting out is total for the built-ins, never for what the app named itself.
    const config = resolveRedactionConfig({
      redaction: { useDefaults: false, headers: ['x-tenant-token'] },
    });

    expect([...config.maskHeaders]).toEqual(['x-tenant-token']);
  });

  it('reads cookie names from the redaction block', () => {
    const config = resolveRedactionConfig({ redaction: { cookies: ['sid'] } });
    expect([...config.maskCookies]).toEqual(['sid']);
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
