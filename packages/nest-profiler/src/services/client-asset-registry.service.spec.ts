import * as path from 'path';
import { ClientAssetRegistry, CORE_CLIENT_SCRIPT } from './client-asset-registry.service';
import { PUBLIC_DIR } from '../views/template-engine';

describe('ClientAssetRegistry', () => {
  let registry: ClientAssetRegistry;

  beforeEach(() => {
    registry = new ClientAssetRegistry();
  });

  it('seeds the core script first and resolves it to public/scripts', () => {
    expect(registry.list()).toEqual([CORE_CLIENT_SCRIPT]);
    expect(registry.resolve(CORE_CLIENT_SCRIPT)).toBe(
      path.join(PUBLIC_DIR, 'scripts', CORE_CLIENT_SCRIPT),
    );
  });

  it('registers an extension bundle after the core script, preserving order', () => {
    registry.register({ file: 'http.js', absPath: '/abs/http.js' });
    registry.register({ file: 'sql.js', absPath: '/abs/sql.js' });

    expect(registry.list()).toEqual([CORE_CLIENT_SCRIPT, 'http.js', 'sql.js']);
    expect(registry.resolve('http.js')).toBe('/abs/http.js');
    expect(registry.resolve('sql.js')).toBe('/abs/sql.js');
  });

  it('ignores attempts to re-register the reserved core script', () => {
    registry.register({ file: CORE_CLIENT_SCRIPT, absPath: '/hijack.js' });

    expect(registry.list()).toEqual([CORE_CLIENT_SCRIPT]);
    expect(registry.resolve(CORE_CLIENT_SCRIPT)).toBe(
      path.join(PUBLIC_DIR, 'scripts', CORE_CLIENT_SCRIPT),
    );
  });

  it('keeps the first registration when a file name is registered twice', () => {
    registry.register({ file: 'http.js', absPath: '/first/http.js' });
    registry.register({ file: 'http.js', absPath: '/second/http.js' });

    expect(registry.list()).toEqual([CORE_CLIENT_SCRIPT, 'http.js']);
    expect(registry.resolve('http.js')).toBe('/first/http.js');
  });

  it('returns undefined for an unregistered file', () => {
    expect(registry.resolve('nope.js')).toBeUndefined();
  });
});
