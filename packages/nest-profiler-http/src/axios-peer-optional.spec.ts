/**
 * Regression guard: this package must never reference `@nestjs/axios` — neither a top-level
 * import nor a lazy `require`. The host application owns `@nestjs/axios` and hands us its
 * `HttpService.axiosRef` via `forRootAsync`. If someone reintroduces any import/require of
 * `@nestjs/axios`, requiring the barrel below would trigger the mocked module (which throws)
 * and this test would fail.
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
