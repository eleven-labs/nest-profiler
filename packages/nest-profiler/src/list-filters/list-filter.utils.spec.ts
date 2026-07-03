import {
  buildCriteria,
  filterAppliesToSection,
  parseFilterValues,
  parseLenientInt,
} from './list-filter.utils';
import type { ProfilerListFilter } from './profiler-list-filter.interface';

const methodFilter: ProfilerListFilter<string> = {
  key: 'method',
  label: 'Method',
  control: 'select',
  parse: (raw) => (raw && raw.length > 0 ? raw : undefined),
  toCriterion: (value) => ({ field: 'method', op: 'eq', value }),
};

const statusFilter: ProfilerListFilter<number> = {
  key: 'status',
  label: 'Status',
  control: 'number',
  parse: parseLenientInt,
  toCriterion: (value) => ({ field: 'statusCode', op: 'eq', value }),
};

const filters = [methodFilter, statusFilter];

describe('parseLenientInt', () => {
  it('parses valid integers', () => {
    expect(parseLenientInt('42')).toBe(42);
    expect(parseLenientInt('0')).toBe(0);
  });

  it('returns undefined for empty, missing or non-numeric values', () => {
    expect(parseLenientInt(undefined)).toBeUndefined();
    expect(parseLenientInt('')).toBeUndefined();
    expect(parseLenientInt('abc')).toBeUndefined();
  });
});

describe('parseFilterValues', () => {
  it('collects only active filters and echoes raw values for the form', () => {
    const { active, raw } = parseFilterValues(filters, { method: 'GET', status: '' });
    expect(active.map((a) => a.filter.key)).toEqual(['method']);
    expect(raw).toEqual({ method: 'GET' });
  });

  it('takes the first value of an array-valued query param', () => {
    const { active } = parseFilterValues(filters, { method: ['GET', 'POST'] });
    expect(active[0]?.value).toBe('GET');
  });

  it('drops non-numeric values instead of producing an active NaN filter', () => {
    const { active } = parseFilterValues(filters, { status: 'oops' });
    expect(active).toHaveLength(0);
  });
});

describe('buildCriteria', () => {
  it('translates each active filter into its declarative criterion', () => {
    const { active } = parseFilterValues(filters, { method: 'GET', status: '404' });
    expect(buildCriteria(active)).toEqual([
      { field: 'method', op: 'eq', value: 'GET' },
      { field: 'statusCode', op: 'eq', value: 404 },
    ]);
  });

  it('returns an empty list when nothing is active', () => {
    const { active } = parseFilterValues(filters, {});
    expect(buildCriteria(active)).toEqual([]);
  });
});

describe('filterAppliesToSection', () => {
  const universal: ProfilerListFilter = { ...methodFilter, forType: undefined };
  const single: ProfilerListFilter = { ...methodFilter, forType: 'http' };
  const many: ProfilerListFilter = { ...methodFilter, forType: ['http', 'graphql'] };

  it('shows a universal filter on every section', () => {
    expect(filterAppliesToSection(universal, 'http')).toBe(true);
    expect(filterAppliesToSection(universal, 'rabbitmq')).toBe(true);
  });

  it('scopes a single-type filter to its own section', () => {
    expect(filterAppliesToSection(single, 'http')).toBe(true);
    expect(filterAppliesToSection(single, 'rabbitmq')).toBe(false);
  });

  it('scopes a multi-type filter to any of its sections', () => {
    expect(filterAppliesToSection(many, 'http')).toBe(true);
    expect(filterAppliesToSection(many, 'graphql')).toBe(true);
    expect(filterAppliesToSection(many, 'command')).toBe(false);
  });
});
