import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { NodeHttpPhases } from './node-http.phases';
import { phasesOfClientRequest } from './client-request-timer';

type Factories = Record<string, unknown>;

let server: http.Server;
let base: string;

/** Restored after the suite: the patch replaces factories on the real Node modules. */
const originals: Array<[Factories, string, unknown]> = [];

function remember(module: unknown, name: string): void {
  const factories = module as Factories;
  originals.push([factories, name, factories[name]]);
}

beforeAll(async () => {
  for (const name of ['request', 'get']) {
    remember(http, name);
    remember(https, name);
  }

  server = http.createServer((_req, res) => {
    setTimeout(() => res.end('{"ok":true}'), 20);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const [factories, name, original] of originals) factories[name] = original;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('NodeHttpPhases', () => {
  it('wraps every request factory of both modules', () => {
    const before = [http.request, http.get, https.request, https.get];
    new NodeHttpPhases().install();

    expect(http.request).not.toBe(before[0]);
    expect(http.get).not.toBe(before[1]);
    expect(https.request).not.toBe(before[2]);
    expect(https.get).not.toBe(before[3]);
  });

  it('does not wrap a second time, whatever many modules install it', () => {
    new NodeHttpPhases().install();
    const patched = http.request;
    new NodeHttpPhases().install();
    expect(http.request).toBe(patched);
  });

  it('times a plain http.get with no per-call wiring', async () => {
    new NodeHttpPhases().install();

    const request = await new Promise<http.ClientRequest>((resolve, reject) => {
      const pending = http.get(`${base}/auto`, (response) => {
        response.resume();
        response.on('end', () => resolve(pending));
      });
      pending.on('error', reject);
    });

    const phases = phasesOfClientRequest(request);
    expect(phases?.firstByte).toBeGreaterThan(10);
    expect(phases?.download).toBeGreaterThanOrEqual(0);
  });

  it('leaves a foreign request implementation working, timed or not', () => {
    const factories = http as unknown as Factories;
    const stubbed = { notAnEventEmitter: true };
    factories.request = () => stubbed;

    new NodeHttpPhases().install();

    expect(http.request('http://example.invalid')).toBe(stubbed);
  });
});
