import type { ProfilerTag } from './profiler-tag.interface';
import { maxTagSeverity, upsertTag } from './profiler-tag.interface';

describe('maxTagSeverity', () => {
  it('returns the highest severity across entries, or null when untagged', () => {
    expect(maxTagSeverity(undefined)).toBeNull();
    expect(maxTagSeverity([{ tags: [] }, {}])).toBeNull();
    expect(
      maxTagSeverity([
        { tags: [{ id: 'slow', label: 'Slow', severity: 'warning' }] },
        { tags: [{ id: 'error', label: 'Error', severity: 'danger' }] },
      ]),
    ).toBe('danger');
    expect(maxTagSeverity([{ tags: [{ id: 'slow', label: 'Slow', severity: 'warning' }] }])).toBe(
      'warning',
    );
    // A later, lower severity must not override an earlier higher one.
    expect(
      maxTagSeverity([
        { tags: [{ id: 'error', label: 'Error', severity: 'danger' }] },
        { tags: [{ id: 'slow', label: 'Slow', severity: 'warning' }] },
      ]),
    ).toBe('danger');
  });
});

describe('upsertTag', () => {
  it('appends a new tag by id', () => {
    const list: ProfilerTag[] = [];
    upsertTag(list, { id: 'slow', label: 'Slow', severity: 'warning' });
    expect(list).toEqual([{ id: 'slow', label: 'Slow', severity: 'warning' }]);
  });

  it('does not duplicate an existing id', () => {
    const list: ProfilerTag[] = [{ id: 'slow', label: 'Slow', severity: 'warning' }];
    upsertTag(list, { id: 'slow', label: 'Slow', severity: 'warning' });
    expect(list).toHaveLength(1);
  });

  it('upgrades to the higher severity and keeps the larger count', () => {
    const list: ProfilerTag[] = [{ id: 'dup', label: 'x2', severity: 'warning', count: 2 }];
    upsertTag(list, { id: 'dup', label: 'x5', severity: 'danger', count: 5 });
    expect(list[0]).toEqual({ id: 'dup', label: 'x5', severity: 'danger', count: 5 });
  });

  it('keeps the existing higher severity when the new one is lower', () => {
    const list: ProfilerTag[] = [{ id: 'e', label: 'Error', severity: 'danger' }];
    upsertTag(list, { id: 'e', label: 'Info', severity: 'info' });
    expect(list[0]?.severity).toBe('danger');
    expect(list[0]?.label).toBe('Error');
  });
});
