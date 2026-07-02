import { join } from 'node:path';
import { HttpClientAssetRegistrar } from './http-client-asset.registrar';
import type { ClientAssetRegistry } from '@eleven-labs/nest-profiler';

describe('HttpClientAssetRegistrar', () => {
  it('registers the http.js bundle with its on-disk path on module init', () => {
    let registration: { file: string; absPath: string } | undefined;
    const register = jest.fn((reg: { file: string; absPath: string }) => {
      registration = reg;
    });
    const registrar = new HttpClientAssetRegistrar({
      register,
    } as unknown as ClientAssetRegistry);

    registrar.onModuleInit();

    expect(register).toHaveBeenCalledTimes(1);
    expect(registration?.file).toBe('http.js');
    expect(registration?.absPath).toContain(join('public', 'scripts', 'http.js'));
  });

  it('is a no-op when the profiler registry is not available', () => {
    const registrar = new HttpClientAssetRegistrar();
    expect(() => registrar.onModuleInit()).not.toThrow();
  });
});
