import { formatMs, nowMs, roundMs, sinceMs } from './clock';

describe('nowMs', () => {
  it('returns an epoch-ms timestamp comparable with Date.now()', () => {
    expect(Math.abs(nowMs() - Date.now())).toBeLessThan(1000);
  });

  it('resolves finer than the millisecond', () => {
    // Two reads separated by a tight busy loop must differ — the whole point of not using Date.now().
    const first = nowMs();
    let spins = 0;
    while (nowMs() === first && spins < 1e6) spins++;
    expect(nowMs()).toBeGreaterThan(first);
  });
});

describe('sinceMs', () => {
  it('measures the elapsed time from a mark', () => {
    const started = nowMs() - 5;
    const elapsed = sinceMs(started);
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(elapsed).toBeLessThan(1000);
  });

  it('never returns a negative duration for a mark in the future', () => {
    expect(sinceMs(nowMs() + 1000)).toBe(0);
  });
});

describe('roundMs', () => {
  it.each([
    [1.23456789, 1.235],
    [0.0004, 0],
    [12, 12],
  ])('rounds %p to the microsecond (%p)', (input, expected) => {
    expect(roundMs(input)).toBe(expected);
  });
});

describe('formatMs', () => {
  it.each([
    [0, '0ms'],
    [0.0004, '400ns'],
    [0.007, '7\u00b5s'],
    [0.075, '75\u00b5s'],
    [0.421, '421\u00b5s'],
    [0.999, '999\u00b5s'],
    [1, '1ms'],
    [1.5, '1.5ms'],
    [12, '12ms'],
    [12.34, '12.3ms'],
    [99.9, '99.9ms'],
    [1234.6, '1.23s'],
    [9999, '10s'],
    [12345, '12.3s'],
    [59_900, '59.9s'],
    [59_960, '60s'],
    [125_000, '2m 5s'],
    [3_600_000, '1h 0m'],
    [7_500_000, '2h 5m'],
    [3_599_900, '1h'],
  ])('formats %p as %p', (input, expected) => {
    expect(formatMs(input)).toBe(expected);
  });

  it.each([undefined, null, NaN])('renders %p as a dash', (input) => {
    expect(formatMs(input)).toBe('—');
  });
});
