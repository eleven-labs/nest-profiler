import { readHttpPhases } from './read-http-phases';

/** A `got` / `@szmarczak/http-timer` breakdown, which the reader understands natively. */
const timerTimings = {
  phases: { wait: 1, dns: 2, tcp: 3, tls: 4, request: 5, firstByte: 6, download: 7, total: 28 },
};

describe('readHttpPhases', () => {
  it('finds nothing on values that cannot carry timings', () => {
    expect(readHttpPhases(undefined)).toBeUndefined();
    expect(readHttpPhases(null)).toBeUndefined();
    expect(readHttpPhases('https://example.com')).toBeUndefined();
    expect(readHttpPhases({})).toBeUndefined();
  });

  it('reads a timer breakdown, dropping the total it does not model', () => {
    expect(readHttpPhases({ timings: timerTimings })).toEqual({
      wait: 1,
      dns: 2,
      tcp: 3,
      tls: 4,
      request: 5,
      firstByte: 6,
      download: 7,
    });
  });

  it('keeps only usable numbers from a timer breakdown', () => {
    const phases = readHttpPhases({
      timings: { phases: { dns: 2, tcp: -1, tls: Number.NaN, firstByte: '30' } },
    });
    expect(phases).toEqual({ dns: 2 });
  });

  it('ignores a breakdown whose every phase is unusable', () => {
    expect(readHttpPhases({ timings: { phases: { dns: 0, tcp: 0 } } })).toBeUndefined();
    expect(readHttpPhases({ timings: { phases: 'nope' } })).toBeUndefined();
    expect(readHttpPhases({ timings: 42 })).toBeUndefined();
  });

  it('walks an axios response to the request underneath', () => {
    const response = { status: 200, request: { timings: timerTimings } };
    expect(readHttpPhases(response)?.dns).toBe(2);
  });

  it('walks an incoming message to the request that produced it', () => {
    expect(readHttpPhases({ req: { timings: timerTimings } })?.tcp).toBe(3);
  });

  // follow-redirects (axios's default transport) hands back a wrapper; the hop that answered is
  // the one whose timings describe the response the caller got.
  it('prefers the final redirect hop over the wrapper', () => {
    const wrapper = {
      timings: { phases: { firstByte: 999 } },
      _currentRequest: { timings: { phases: { firstByte: 12 } } },
    };
    expect(readHttpPhases({ request: wrapper })).toEqual({ firstByte: 12 });
  });

  it('survives a throwing getter instead of failing the call', () => {
    const hostile = {
      get request(): never {
        throw new Error('ProxyProviderNotResolvedException');
      },
    };
    expect(readHttpPhases(hostile)).toBeUndefined();
  });

  it('stops walking before an adversarial chain can spin', () => {
    let deep: Record<string, unknown> = { timings: timerTimings };
    for (let i = 0; i < 6; i += 1) deep = { request: deep };
    expect(readHttpPhases(deep)).toBeUndefined();
  });

  it('does not loop on a self-referencing object', () => {
    const looping: Record<string, unknown> = {};
    looping.request = looping;
    expect(readHttpPhases(looping)).toBeUndefined();
  });
});
