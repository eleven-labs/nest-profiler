import { NoopProfilerService } from './noop-profiler.service';

describe('NoopProfilerService', () => {
  const service = new NoopProfilerService();

  it('flush() resolves without doing anything', async () => {
    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('getCurrentToken() returns undefined', () => {
    expect(service.getCurrentToken()).toBeUndefined();
  });

  it('mutators never throw and record nothing', () => {
    const now = Date.now();
    expect(() => service.addException({ name: 'E', message: 'm', timestamp: now })).not.toThrow();
    expect(() => service.addEvent({ eventName: 'ev', timestamp: now })).not.toThrow();
    expect(() => service.setSecurityContext({ isAuthenticated: false })).not.toThrow();
  });

  it('startSpan() returns a no-op stop function', () => {
    const stop = service.startSpan('phase');
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});
