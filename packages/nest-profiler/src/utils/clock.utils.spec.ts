import { elapsedMs, markProfileStart, monotonicNow, profileElapsedMs } from './clock.utils';
import type { Profile } from '../interfaces/profile.interface';

function makeProfile(startTime = Date.now()): Profile {
  return {
    token: 't',
    createdAt: startTime,
    entrypoint: { type: 'http', data: {} },
    performance: { startTime, heapUsed: 0 },
    logs: [],
    exceptions: [],
    collectors: {},
  };
}

describe('monotonicNow', () => {
  it('never goes backwards, whatever the wall clock does', () => {
    const first = monotonicNow();
    jest.spyOn(Date, 'now').mockReturnValue(0); // wall clock stepped to the epoch
    expect(monotonicNow()).toBeGreaterThanOrEqual(first);
    jest.restoreAllMocks();
  });
});

describe('elapsedMs', () => {
  it('resolves work far below a millisecond instead of flooring it to zero', () => {
    const from = monotonicNow();
    // Enough arithmetic to take a measurable but sub-millisecond amount of time.
    let sink = 0;
    for (let i = 0; i < 20_000; i++) sink += i;
    expect(sink).toBeGreaterThan(0);

    const elapsed = elapsedMs(from);
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it('rounds to microsecond precision rather than shipping float noise', () => {
    const decimals = (value: number): number => (String(value).split('.')[1] ?? '').length;
    for (let i = 0; i < 20; i++) {
      expect(decimals(elapsedMs(monotonicNow()))).toBeLessThanOrEqual(3);
    }
  });

  it('clamps at zero so a duration can never be negative', () => {
    expect(elapsedMs(monotonicNow() + 5_000)).toBe(0);
  });
});

describe('profileElapsedMs', () => {
  it('measures a marked profile on the monotonic clock, ignoring a wall-clock step', () => {
    const profile = makeProfile(1_000_000);
    markProfileStart(profile);

    // The wall clock jumps backwards mid-request (an NTP step). The old
    // `Date.now() - startTime` arithmetic produced a large negative duration here.
    jest.spyOn(Date, 'now').mockReturnValue(500_000);
    const elapsed = profileElapsedMs(profile);
    jest.restoreAllMocks();

    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('falls back to the wall clock for a profile nothing marked', () => {
    const profile = makeProfile(Date.now() - 250);
    // A custom entrypoint kind built by hand still reports a duration, on the old terms.
    expect(profileElapsedMs(profile)).toBeGreaterThanOrEqual(250);
  });

  it('clamps the fallback at zero when the wall clock has stepped backwards', () => {
    const profile = makeProfile(Date.now() + 10_000);
    expect(profileElapsedMs(profile)).toBe(0);
  });

  it('keeps each profile on its own origin', () => {
    const first = makeProfile();
    markProfileStart(first, monotonicNow() - 500);
    const second = makeProfile();
    markProfileStart(second);

    expect(profileElapsedMs(first)).toBeGreaterThanOrEqual(500);
    expect(profileElapsedMs(second)).toBeLessThan(500);
  });

  it('leaves no trace on the profile, so nothing reaches storage or the export', () => {
    const profile = makeProfile();
    markProfileStart(profile);

    expect(Object.keys(profile.performance)).toEqual(['startTime', 'heapUsed']);
    expect(Reflect.ownKeys(profile)).not.toContain('monotonicStart');
    expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
  });
});
