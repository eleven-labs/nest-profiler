import { formatDuration } from './duration';

describe('formatDuration', () => {
  it('keeps two decimals below 10ms, where they carry the whole signal', () => {
    expect(formatDuration(0.42)).toBe('0.42');
    expect(formatDuration(1.618)).toBe('1.62');
    expect(formatDuration(9.999)).toBe('10');
  });

  it('keeps one decimal between 10ms and 100ms', () => {
    expect(formatDuration(12.44)).toBe('12.4');
    expect(formatDuration(99.94)).toBe('99.9');
  });

  it('rounds to a whole millisecond from 100ms up', () => {
    expect(formatDuration(340.9)).toBe('341');
    expect(formatDuration(1234.56)).toBe('1235');
  });

  it('trims trailing zeros so a round value reads as one', () => {
    expect(formatDuration(1.6)).toBe('1.6');
    expect(formatDuration(2)).toBe('2');
    expect(formatDuration(10)).toBe('10');
  });

  it('distinguishes "no time at all" from "faster than we can show"', () => {
    expect(formatDuration(0)).toBe('0');
    expect(formatDuration(0.004)).toBe('<0.01');
  });

  it('never renders a negative or non-finite value as a number', () => {
    expect(formatDuration(-5)).toBe('0');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('does not print the float noise a monotonic measurement carries', () => {
    expect(formatDuration(1.6000000000058208)).toBe('1.6');
  });
});
