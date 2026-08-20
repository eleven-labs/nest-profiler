import { createDateHelpers, hostTimezone, isValidTimezone } from './date-helpers';

// The Jest preset pins TZ to Europe/Paris, so "host timezone" means Europe/Paris here.
describe('date-helpers', () => {
  const summer = Date.UTC(2026, 6, 1, 22, 30, 15, 250); // Paris UTC+2, Tokyo UTC+9
  const winter = Date.UTC(2026, 0, 2, 3, 4, 5, 678); // Paris UTC+1

  describe('createDateHelpers', () => {
    it('renders in the host timezone when no zone is given', () => {
      const { isoDate, timeOnly } = createDateHelpers();
      expect(isoDate(summer)).toBe('2026-07-02 00:30:15');
      expect(timeOnly(winter)).toBe('04:04:05.678');
    });

    it('renders in the given timezone', () => {
      const tokyo = createDateHelpers('Asia/Tokyo');
      expect(tokyo.isoDate(summer)).toBe('2026-07-02 07:30:15');
      expect(tokyo.timeOnly(summer)).toBe('07:30:15.250');

      const newYork = createDateHelpers('America/New_York');
      expect(newYork.isoDate(summer)).toBe('2026-07-01 18:30:15');

      const utc = createDateHelpers('UTC');
      expect(utc.isoDate(summer)).toBe('2026-07-01 22:30:15');
    });

    it('applies the offset in force at that instant, DST included', () => {
      const paris = createDateHelpers('Europe/Paris');
      // Same wall-clock input, one hour apart in offset: +02:00 in July, +01:00 in January.
      expect(paris.isoDate(summer)).toBe('2026-07-02 00:30:15');
      expect(paris.isoDate(winter)).toBe('2026-01-02 04:04:05');
    });

    it('keeps midnight at 00 rather than 24, and pads milliseconds', () => {
      const utc = createDateHelpers('UTC');
      const midnight = Date.UTC(2026, 0, 2, 0, 0, 0, 7);
      expect(utc.isoDate(midnight)).toBe('2026-01-02 00:00:00');
      expect(utc.timeOnly(midnight)).toBe('00:00:00.007');
    });

    it('handles a zone whose offset is not a whole hour', () => {
      // Asia/Kathmandu is UTC+05:45 — the minutes must come from the zone, not the host.
      expect(createDateHelpers('Asia/Kathmandu').isoDate(summer)).toBe('2026-07-02 04:15:15');
    });
  });

  describe('hostTimezone', () => {
    it('returns the timezone the process runs in, as selected by TZ', () => {
      expect(hostTimezone()).toBe('Europe/Paris');
    });

    // An empty or unparseable `TZ` (`TZ=`, `TZ=:/etc/localtime`) leaves the runtime with a
    // working offset but no name: ICU answers 'Etc/Unknown', which `Intl` then refuses as an
    // input. Reporting no name keeps that value from travelling back into a formatter.
    it.each(['Etc/Unknown', undefined])('reports no name when the runtime resolves %s', (zone) => {
      const spy = jest
        .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
        .mockReturnValue({ timeZone: zone } as Intl.ResolvedDateTimeFormatOptions);
      try {
        expect(hostTimezone()).toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('isValidTimezone', () => {
    it('accepts IANA names this runtime knows', () => {
      expect(isValidTimezone('Europe/Paris')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('rejects anything else', () => {
      expect(isValidTimezone('Middle/Earth')).toBe(false);
      expect(isValidTimezone('CEST')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
    });
  });
});
