import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { instrumentClientRequest, phasesOfClientRequest } from './client-request-timer';

/**
 * The connection listeners are `once` listeners on the *socket*, and a keep-alive socket never
 * re-emits `lookup`/`connect`/`secureConnect` — so nothing consumes them and they pile up, one
 * set per request, for as long as the pooled socket lives. Node >= 19 keeps `http.globalAgent`
 * alive by default, so this is the ordinary path.
 */
describe('instrumentClientRequest on a pooled socket', () => {
  let server: http.Server;
  let port: number;
  let agent: http.Agent;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  });

  afterEach(() => agent.destroy());

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Resolves with the socket the request was assigned, once the response has been consumed. */
  const call = (): Promise<Socket> =>
    new Promise((resolve, reject) => {
      let socket: Socket;
      const request = http.request({ port, agent, path: '/' }, (response) => {
        response.resume();
        response.on('end', () => resolve(socket));
      });
      instrumentClientRequest(request);
      request.on('socket', (s: Socket) => void (socket = s));
      request.on('error', reject);
      request.end();
    });

  it('does not accumulate connection listeners across reuses of one socket', async () => {
    let socket!: Socket;
    for (let i = 0; i < 15; i++) socket = await call();

    // One set at most: the in-flight request's, if any is still attached.
    expect(socket.listenerCount('lookup')).toBeLessThanOrEqual(1);
    expect(socket.listenerCount('connect')).toBeLessThanOrEqual(1);
    expect(socket.listenerCount('secureConnect')).toBeLessThanOrEqual(1);
  });

  it('emits no MaxListenersExceededWarning over a burst on one socket', async () => {
    const warnings: Error[] = [];
    const capture = (warning: Error): void => void warnings.push(warning);
    process.on('warning', capture);
    try {
      for (let i = 0; i < 15; i++) await call();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('warning', capture);
    }

    expect(warnings.filter((w) => w.name === 'MaxListenersExceededWarning')).toEqual([]);
  });

  it('still measures the connection phases on the first, fresh connection', async () => {
    let captured: http.ClientRequest | undefined;
    await new Promise<void>((resolve, reject) => {
      const request = http.request({ port, agent, path: '/' }, (response) => {
        response.resume();
        response.on('end', () => resolve());
      });
      instrumentClientRequest(request);
      captured = request;
      request.on('error', reject);
      request.end();
    });

    const phases = phasesOfClientRequest(captured!);
    // A fresh connection goes through connect; the phase is only recorded if the listener ran.
    expect(phases?.tcp).toBeDefined();
    expect(phases?.firstByte).toBeDefined();
  });
});
