import { applyListFilters, parseFilterValues, parseLenientInt } from './list-filter.utils';
import type { ProfilerListFilter } from './profiler-list-filter.interface';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(method: string, statusCode?: number): Profile {
  return {
    token: Math.random().toString(36).slice(2),
    createdAt: Date.now(),
    request: { method, url: '/', headers: {}, query: {} },
    response: statusCode !== undefined ? { statusCode, headers: {} } : undefined,
    performance: { startTime: 0, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

const methodFilter: ProfilerListFilter<string> = {
  key: 'method',
  label: 'Method',
  control: 'select',
  parse: (raw) => (raw && raw.length > 0 ? raw : undefined),
  matches: (p, v) => p.request.method === v,
};

const statusFilter: ProfilerListFilter<number> = {
  key: 'status',
  label: 'Status',
  control: 'number',
  parse: parseLenientInt,
  matches: (p, v) => p.response?.statusCode === v,
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

describe('applyListFilters', () => {
  const profiles = [makeProfile('GET', 200), makeProfile('POST', 500), makeProfile('GET', 404)];

  it('returns the input unchanged when nothing is active', () => {
    expect(applyListFilters([], profiles)).toBe(profiles);
  });

  it('keeps profiles matching every active filter (AND semantics)', () => {
    const { active } = parseFilterValues(filters, { method: 'GET', status: '404' });
    const result = applyListFilters(active, profiles);
    expect(result).toHaveLength(1);
    expect(result[0]?.response?.statusCode).toBe(404);
  });

  it('applies a single active filter', () => {
    const { active } = parseFilterValues(filters, { method: 'GET' });
    expect(applyListFilters(active, profiles)).toHaveLength(2);
  });
});
