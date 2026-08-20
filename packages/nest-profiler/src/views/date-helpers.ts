/**
 * Timestamp rendering for the profiler UI.
 *
 * Profiles store epoch milliseconds and every page is rendered server-side, so a timestamp has
 * to be projected into a timezone before it can be displayed. That timezone is the process's
 * own by default, and the `timezone` module option overrides it — an application running in a
 * UTC container is read by people who are not in UTC.
 */

/** `isoDate` / `timeOnly` bound to one display timezone. */
export interface DateHelpers {
  /** `YYYY-MM-DD HH:mm:ss` */
  isoDate: (ts: number) => string;
  /** `HH:mm:ss.mmm` */
  timeOnly: (ts: number) => string;
}

/**
 * `hourCycle: 'h23'` keeps midnight at `00`, and reading the parts by type rather than the
 * formatted string keeps the output independent of the locale's date order.
 */
const PART_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

/**
 * The IANA timezone the process runs in — what the `TZ` environment variable selects (the
 * runtime normalises `TZ=EST5EDT` to `America/New_York`), falling back to the system zone.
 *
 * `undefined` when the runtime cannot name it: an empty or unparseable `TZ` still yields a
 * working offset, but ICU answers `Etc/Unknown` (or nothing at all) — a name that is not
 * valid `Intl` input, so it must never be passed back as a `timeZone`.
 */
export function hostTimezone(): string | undefined {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return !resolved || resolved === 'Etc/Unknown' ? undefined : resolved;
}

/** Whether `timeZone` is an IANA name this runtime knows (`Europe/Paris`, `UTC`, …). */
export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the two date helpers for `timeZone` (an IANA name). Omit it to render in the host
 * timezone. The zone must be valid — check it with {@link isValidTimezone} first, since an
 * unknown name makes `Intl` throw.
 */
export function createDateHelpers(timeZone?: string): DateHelpers {
  // One formatter for every timestamp of every page: building it per call would dominate the
  // cost of rendering a list of a hundred profiles.
  const formatter = new Intl.DateTimeFormat('en-US', { ...PART_OPTIONS, timeZone });

  const partsOf = (ts: number): Record<string, string> => {
    const parts: Record<string, string> = {};
    for (const { type, value } of formatter.formatToParts(ts)) parts[type] = value;
    return parts;
  };

  return {
    isoDate: (ts: number): string => {
      const p = partsOf(ts);
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
    },
    timeOnly: (ts: number): string => {
      const p = partsOf(ts);
      // Milliseconds are the same in every timezone, so they come straight off the Date.
      return `${p.hour}:${p.minute}:${p.second}.${pad(new Date(ts).getMilliseconds(), 3)}`;
    },
  };
}
