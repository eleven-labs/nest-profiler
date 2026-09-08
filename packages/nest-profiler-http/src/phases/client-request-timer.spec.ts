import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  instrumentClientRequest,
  isInstrumentedClientRequest,
  phasesOfClientRequest,
} from './client-request-timer';
import { readHttpPhases } from './read-http-phases';

/** A real server, because the phases are derived from real socket and stream events. */
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 20);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Call {
  request: http.ClientRequest;
  response: http.IncomingMessage;
}

/** Issues a GET, timing it the way the `node:http` provider does: right after creation. */
function get(url: string, options: http.RequestOptions = {}): Promise<Call> {
  return new Promise<Call>((resolve, reject) => {
    const request = http.request(url, options, (response) => {
      response.resume();
      response.on('end', () => resolve({ request, response }));
    });
    instrumentClientRequest(request);
    request.on('error', reject);
    request.end();
  });
}

describe('instrumentClientRequest', () => {
  it('measures the phases of a real request', async () => {
    const { request } = await get(`${base}/timed`);
    const phases = phasesOfClientRequest(request);

    expect(phases).toBeDefined();
    expect(phases?.wait).toBeGreaterThanOrEqual(0);
    expect(phases?.tcp).toBeGreaterThanOrEqual(0);
    expect(phases?.request).toBeGreaterThanOrEqual(0);
    // The handler sleeps 20ms before answering, so the wait for the first byte is the bulk of it.
    expect(phases?.firstByte).toBeGreaterThan(10);
    expect(phases?.download).toBeGreaterThanOrEqual(0);
  });

  it('reports no DNS phase for an IP literal, which resolves nothing', async () => {
    const { request } = await get(`${base}/ip`);
    expect(phasesOfClientRequest(request)?.dns).toBeUndefined();
  });

  it('measures DNS resolution for a hostname', async () => {
    const port = (server.address() as AddressInfo).port;
    const { request } = await get(`http://localhost:${port}/dns`);
    expect(phasesOfClientRequest(request)?.dns).toBeGreaterThanOrEqual(0);
  });

  it('is found from the response, which is all an adapter usually holds', async () => {
    const { request, response } = await get(`${base}/from-response`);
    expect(readHttpPhases(response)).toEqual(phasesOfClientRequest(request));
  });

  it('omits the handshake on a reused connection rather than reporting it as zero', async () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const first = await get(`${base}/warm`, { agent });
      expect(phasesOfClientRequest(first.request)?.tcp).toBeGreaterThanOrEqual(0);

      const second = await get(`${base}/warm`, { agent });
      const phases = phasesOfClientRequest(second.request);
      expect(phases?.tcp).toBeUndefined();
      expect(phases?.dns).toBeUndefined();
      expect(phases?.firstByte).toBeGreaterThan(10);
    } finally {
      agent.destroy();
    }
  });

  it('keeps what it measured when the connection fails', async () => {
    const request = http.request('http://127.0.0.1:1/refused');
    instrumentClientRequest(request);
    await new Promise<void>((resolve) => {
      request.on('error', () => resolve());
      request.end();
    });

    expect(phasesOfClientRequest(request)?.download).toBeUndefined();
  });

  // `agent: false` on the requests this suite abandons: the default agent keeps connections
  // alive, and destroying a request returns a dead socket to the pool for the next test to pick.
  it('reports nothing while a request has not started', () => {
    const request = http.request(`${base}/pending`, { agent: false });
    instrumentClientRequest(request);
    expect(phasesOfClientRequest(request)).toBeUndefined();
    request.on('error', () => undefined);
    request.destroy();
  });

  it('ignores a request it is not timing', () => {
    const request = http.request(`${base}/untimed`, { agent: false });
    expect(isInstrumentedClientRequest(request)).toBe(false);
    expect(phasesOfClientRequest(request)).toBeUndefined();
    request.on('error', () => undefined);
    request.destroy();
  });

  it('stays idempotent, so a double install does not restart the clock', async () => {
    const request = http.request(`${base}/twice`, { agent: false });
    instrumentClientRequest(request);
    expect(isInstrumentedClientRequest(request)).toBe(true);

    await new Promise<void>((resolve) => {
      request.on('response', (response) => {
        instrumentClientRequest(request);
        response.resume();
        response.on('end', () => resolve());
      });
      request.end();
    });

    const phases = phasesOfClientRequest(request);
    expect(phases?.firstByte).toBeGreaterThan(10);
    expect(request.listenerCount('response')).toBeLessThanOrEqual(2);
  });
});

/**
 * The event sequence, driven by hand. A real request cannot be made to produce every path on
 * demand — a TLS handshake needs a certificate, an aborted body needs a server that lies about
 * its length — and the derivation is exactly where those paths matter.
 */
describe('instrumentClientRequest — derived from the event sequence', () => {
  class FakeSocket extends EventEmitter {}
  class FakeRequest extends EventEmitter {
    socket?: FakeSocket;
  }

  const asRequest = (fake: FakeRequest): http.ClientRequest =>
    fake as unknown as http.ClientRequest;

  /** Lets the monotonic clock advance between two marks, so a phase is measurably non-zero. */
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 2));

  it('reports the full breakdown of an HTTPS request, handshake included', async () => {
    const request = new FakeRequest();
    const socket = new FakeSocket();
    const response = new EventEmitter();
    instrumentClientRequest(asRequest(request));

    await tick();
    request.emit('socket', socket);
    await tick();
    socket.emit('lookup');
    await tick();
    socket.emit('connect');
    await tick();
    socket.emit('secureConnect');
    await tick();
    request.emit('finish');
    await tick();
    request.emit('response', response);
    await tick();
    response.emit('end');

    const phases = phasesOfClientRequest(asRequest(request));
    expect(phases?.wait).toBeGreaterThan(0);
    expect(phases?.dns).toBeGreaterThan(0);
    expect(phases?.tcp).toBeGreaterThan(0);
    expect(phases?.tls).toBeGreaterThan(0);
    expect(phases?.request).toBeGreaterThan(0);
    expect(phases?.firstByte).toBeGreaterThan(0);
    expect(phases?.download).toBeGreaterThan(0);
  });

  // A small body is flushed to the socket before the handshake finishes. Reported as-is that is a
  // negative send; the time belongs to the wait for the first byte.
  it('never reports a negative send when the body was flushed before connecting', async () => {
    const request = new FakeRequest();
    const socket = new FakeSocket();
    instrumentClientRequest(asRequest(request));

    request.emit('socket', socket);
    request.emit('finish');
    await tick();
    socket.emit('connect');
    await tick();
    request.emit('response', new EventEmitter());

    const phases = phasesOfClientRequest(asRequest(request));
    expect(phases?.request).toBe(0);
    expect(phases?.firstByte).toBeGreaterThan(0);
  });

  it('closes the download when the response is aborted mid-body', async () => {
    const request = new FakeRequest();
    const response = new EventEmitter();
    instrumentClientRequest(asRequest(request));

    request.emit('socket', new FakeSocket());
    request.emit('response', response);
    await tick();
    response.emit('aborted');

    expect(phasesOfClientRequest(asRequest(request))?.download).toBeGreaterThan(0);
  });

  it('closes the download when the response stream errors', async () => {
    const request = new FakeRequest();
    const response = new EventEmitter();
    instrumentClientRequest(asRequest(request));

    request.emit('socket', new FakeSocket());
    request.emit('response', response);
    await tick();
    response.emit('error', new Error('reset'));

    expect(phasesOfClientRequest(asRequest(request))?.download).toBeGreaterThan(0);
  });

  it('times a socket already assigned when it is asked to start', async () => {
    const request = new FakeRequest();
    request.socket = new FakeSocket();
    instrumentClientRequest(asRequest(request));

    await tick();
    request.socket.emit('connect');
    await tick();
    request.emit('response', new EventEmitter());

    const phases = phasesOfClientRequest(asRequest(request));
    expect(phases?.tcp).toBeGreaterThan(0);
    expect(phases?.firstByte).toBeGreaterThan(0);
  });
});
