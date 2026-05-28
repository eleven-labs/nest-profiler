jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});

import * as fs from 'fs';
import { toolbarSnippet } from './layout.view';
import type { CollectorPanelInfo } from '../collectors/collector-registry.service';

describe('toolbarSnippet', () => {
  it('renders the toolbar with the token (sliced) and profiler link', () => {
    const html = toolbarSnippet('abcdef1234567890', '/_profiler');
    expect(html).toContain('id="profiler-toolbar"');
    expect(html).toContain('/_profiler/abcdef1234567890');
    expect(html).toContain('abcdef12'); // token.slice(0, 8)
  });

  it('renders a tab link for panels with a badge value', () => {
    const panels: CollectorPanelInfo[] = [
      { name: 'timeline', label: 'Timeline', priority: 5, badgeValue: '12ms' },
      { name: 'hidden', label: 'Hidden', priority: 10, badgeValue: null },
    ];
    const html = toolbarSnippet('token123', '/_profiler', panels);
    expect(html).toContain('tab=timeline');
    expect(html).toContain('12ms');
    expect(html).not.toContain('tab=hidden');
  });

  it('caches the template source after the first render', () => {
    // Prime the module-level cache, then assert no further filesystem reads.
    toolbarSnippet('warmup00', '/_profiler');
    (fs.readFileSync as jest.Mock).mockClear();
    toolbarSnippet('second00', '/_profiler');
    expect(fs.readFileSync as jest.Mock).not.toHaveBeenCalled();
  });
});
