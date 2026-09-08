import {
  HTTP_PHASE_HINTS,
  HTTP_PHASE_LABELS,
  HTTP_PHASE_SEQUENCE,
  formatPhaseDuration,
  hasHttpPhases,
  sumHttpPhases,
} from './http-phases.interface';

describe('HttpPhases contract', () => {
  it('sums the measured phases', () => {
    expect(sumHttpPhases({ dns: 1.5, tcp: 2, firstByte: 30 })).toBe(33.5);
  });

  it('ignores values that cannot be drawn', () => {
    expect(sumHttpPhases({ dns: 0, tcp: -1, firstByte: Number.NaN })).toBe(0);
    expect(sumHttpPhases({ download: Number.POSITIVE_INFINITY })).toBe(0);
    expect(sumHttpPhases(undefined)).toBe(0);
  });

  it('reports a breakdown with nothing measurable as absent', () => {
    expect(hasHttpPhases(undefined)).toBe(false);
    expect(hasHttpPhases({})).toBe(false);
    expect(hasHttpPhases({ dns: 0 })).toBe(false);
    expect(hasHttpPhases({ dns: 0.001 })).toBe(true);
  });

  // The panel and the trace meta both index these maps by the sequence: a phase added to the
  // contract without a label or a hint would render as a blank segment.
  it('labels and explains every phase of the sequence', () => {
    for (const name of HTTP_PHASE_SEQUENCE) {
      expect(HTTP_PHASE_LABELS[name]).toBeTruthy();
      expect(HTTP_PHASE_HINTS[name]).toBeTruthy();
    }
    expect(HTTP_PHASE_SEQUENCE).toHaveLength(Object.keys(HTTP_PHASE_LABELS).length);
  });

  it('formats a sub-millisecond phase without rounding it away', () => {
    expect(formatPhaseDuration(0.4213)).toBe('0.42ms');
    expect(formatPhaseDuration(9.999)).toBe('10ms');
    expect(formatPhaseDuration(32.61)).toBe('33ms');
  });
});
