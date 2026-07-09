/**
 * Regression guard: this package must never reference `@nestjs/axios` — neither a top-level
 * import nor a lazy `require`. The host application owns `@nestjs/axios`; the axios adapter
 * auto-discovers its `HttpService`/axios instances via `DiscoveryService`. If someone reintroduces
 * any import/require of `@nestjs/axios`, requiring the barrel below would trigger the mocked module
 * (which throws) and this test would fail.
 */
describe('no @nestjs/axios dependency', () => {
  it('the package barrel imports cleanly when @nestjs/axios is missing', () => {
    jest.isolateModules(() => {
      jest.doMock('@nestjs/axios', () => {
        throw new Error("Cannot find module '@nestjs/axios' (simulated absent peer)");
      });
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./index');
      }).not.toThrow();
      jest.dontMock('@nestjs/axios');
    });
  });
});

/**
 * The root barrel is the client-agnostic surface: importing it must never pull in a client
 * adapter (and thus a client library). Adapters live on their own subpaths (`/axios`, `/fetch`)
 * and must not leak back into the barrel.
 */
describe('client-agnostic barrel', () => {
  it('does not re-export any client adapter', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const barrel = require('./index') as Record<string, unknown>;
    expect(barrel).toHaveProperty('HttpCollectorModule');
    expect(barrel).toHaveProperty('HttpProfilerRecorder');
    expect(barrel).not.toHaveProperty('AxiosInstrumentation');
    expect(barrel).not.toHaveProperty('FetchInstrumentation');
  });
});
