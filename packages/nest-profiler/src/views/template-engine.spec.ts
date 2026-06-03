import { HELPERS } from './template-engine';

describe('template-engine HELPERS', () => {
  describe('gqlTypeClass', () => {
    it('maps known GraphQL operation types to their badge class', () => {
      expect(HELPERS.gqlTypeClass('query')).toBe('badge-gql-query');
      expect(HELPERS.gqlTypeClass('mutation')).toBe('badge-gql-mutation');
      expect(HELPERS.gqlTypeClass('subscription')).toBe('badge-gql-subscription');
    });

    it('falls back to the default class for unknown operation types', () => {
      expect(HELPERS.gqlTypeClass('unknown')).toBe('badge-default');
    });
  });

  describe('methodClass', () => {
    it('maps known HTTP methods to their badge class', () => {
      expect(HELPERS.methodClass('GET')).toBe('badge-get');
      expect(HELPERS.methodClass('DELETE')).toBe('badge-delete');
    });

    it('falls back to the default class for unknown methods', () => {
      expect(HELPERS.methodClass('TRACE')).toBe('badge-default');
    });
  });

  describe('statusClass', () => {
    it('classifies status codes by range', () => {
      expect(HELPERS.statusClass(200)).toBe('badge-2xx');
      expect(HELPERS.statusClass(301)).toBe('badge-3xx');
      expect(HELPERS.statusClass(404)).toBe('badge-4xx');
      expect(HELPERS.statusClass(500)).toBe('badge-5xx');
    });
  });

  describe('logLevelClass', () => {
    it('maps known levels and falls back to default', () => {
      expect(HELPERS.logLevelClass('error')).toBe('badge-error');
      expect(HELPERS.logLevelClass('unknown')).toBe('badge-default');
    });
  });

  describe('mb', () => {
    it('formats bytes as megabytes with two decimals', () => {
      expect(HELPERS.mb(1024 * 1024)).toBe('1.00 MB');
      expect(HELPERS.mb(1024 * 1024 * 2.5)).toBe('2.50 MB');
    });
  });

  describe('isoDate / timeOnly', () => {
    const ts = Date.UTC(2026, 0, 2, 3, 4, 5, 678);

    it('isoDate renders a space-separated date down to seconds', () => {
      expect(HELPERS.isoDate(ts)).toBe('2026-01-02 03:04:05');
    });

    it('timeOnly renders the time portion with milliseconds', () => {
      expect(HELPERS.timeOnly(ts)).toBe('03:04:05.678');
    });
  });

  describe('toJson', () => {
    it('pretty-prints the value', () => {
      expect(HELPERS.toJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    });
  });

  describe('highlightSql', () => {
    it('escapes HTML and wraps SQL keywords', () => {
      const out = HELPERS.highlightSql('SELECT * FROM t WHERE a < 1');
      expect(out).toContain('<span class="sql-keyword">SELECT</span>');
      expect(out).toContain('<span class="sql-keyword">FROM</span>');
      expect(out).toContain('&lt;'); // the `<` was escaped
    });
  });

  describe('kvTable', () => {
    it('renders an "Empty" placeholder for an empty object', () => {
      expect(HELPERS.kvTable({})).toContain('Empty');
    });

    it('escapes keys and values', () => {
      const html = HELPERS.kvTable({ '<key>': '<value>' });
      expect(html).toContain('&lt;key&gt;');
      expect(html).toContain('&lt;value&gt;');
    });

    it('stringifies arrays, objects and nullish values', () => {
      const html = HELPERS.kvTable({
        arr: [1, 2],
        obj: { x: 1 },
        nothing: null,
      });
      expect(html).toContain('1, 2');
      expect(html).toContain('{&quot;x&quot;:1}');
    });

    it('renders an empty string for values that cannot be stringified (e.g. functions)', () => {
      const html = HELPERS.kvTable({ fn: () => undefined });
      // The key is rendered, but the function value collapses to an empty cell.
      expect(html).toContain('fn');
      expect(html).not.toContain('=&gt;');
    });
  });
});
