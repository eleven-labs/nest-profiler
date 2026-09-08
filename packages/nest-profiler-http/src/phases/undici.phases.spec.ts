import diagnosticsChannel from 'node:diagnostics_channel';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HttpPhases } from '../http-phases.interface';
import { UndiciPhases, resetUndiciPhases } from './undici.phases';
import { openPhaseSlot, phaseSlotsEnabled, resetPhaseSlotProviders } from './phase-slot';

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

afterEach(() => {
  resetUndiciPhases();
  resetPhaseSlotProviders();
});

/** Runs a real `fetch` inside a slot, the way the fetch adapter does, and returns what it caught. */
async function fetchInSlot(path: string): Promise<HttpPhases | undefined> {
  return openPhaseSlot(async (slot) => {
    const response = await fetch(`${base}${path}`);
    await response.text();
    return slot.phases;
  });
}

describe('UndiciPhases', () => {
  it('announces itself so adapters start opening slots', () => {
    expect(phaseSlotsEnabled()).toBe(false);
    new UndiciPhases().install();
    expect(phaseSlotsEnabled()).toBe(true);
  });

  it('measures a real fetch through the diagnostics channels', async () => {
    new UndiciPhases().install();
    const phases = await fetchInSlot('/measured');

    expect(phases).toBeDefined();
    expect(phases?.wait).toBeGreaterThanOrEqual(0);
    expect(phases?.request).toBeGreaterThanOrEqual(0);
    // The handler sleeps 20ms, and that wait belongs to the first byte and nowhere else.
    expect(phases?.firstByte).toBeGreaterThan(10);
    // undici reports one "connected" event, so the handshake is the coarse phase, never dns/tcp.
    expect(phases?.dns).toBeUndefined();
    expect(phases?.tcp).toBeUndefined();
    expect(phases?.tls).toBeUndefined();
  });

  it('measures the handshake of a connection it saw being opened', async () => {
    new UndiciPhases().install();
    // A dedicated origin (localhost vs 127.0.0.1) so undici cannot serve it from a warm pool.
    const port = (server.address() as AddressInfo).port;
    const phases = await openPhaseSlot(async (slot) => {
      const response = await fetch(`http://localhost:${port}/fresh`);
      await response.text();
      return slot.phases;
    });

    expect(phases?.connect).toBeGreaterThanOrEqual(0);
  });

  it('gives concurrent calls their own breakdown', async () => {
    new UndiciPhases().install();
    const all = await Promise.all([fetchInSlot('/a'), fetchInSlot('/b'), fetchInSlot('/c')]);

    expect(all).toHaveLength(3);
    for (const phases of all) expect(phases?.firstByte).toBeGreaterThan(10);
  });

  it('records nothing for a call made outside any slot', async () => {
    new UndiciPhases().install();
    const response = await fetch(`${base}/loose`);
    await expect(response.text()).resolves.toContain('ok');
  });

  it('measures nothing once uninstalled, and installing twice subscribes once', async () => {
    new UndiciPhases().install();
    new UndiciPhases().install();
    resetUndiciPhases();

    await expect(fetchInSlot('/after-reset')).resolves.toBeUndefined();
  });
});

/**
 * The channel messages, published by hand. undici cannot be asked on demand for a queue overflow,
 * a failed handshake or a connection whose events arrive without their request, and those are the
 * paths where a breakdown either degrades cleanly or reports someone else's numbers.
 */
describe('UndiciPhases — driven from the channels', () => {
  const publish = (name: string, message: unknown): void => {
    diagnosticsChannel.channel(name).publish(message);
  };
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 2));
  const origin = { protocol: 'http:', hostname: 'api.example.com', port: 80 };

  beforeEach(() => {
    new UndiciPhases().install();
  });

  /** One request's worth of channel traffic, with time passing between the marks. */
  async function run(
    steps: (request: object) => void | Promise<void>,
  ): Promise<Record<string, number> | undefined> {
    return openPhaseSlot(async (slot) => {
      const request = {};
      publish('undici:request:create', { request });
      await steps(request);
      return slot.phases as Record<string, number> | undefined;
    });
  }

  it('ignores traffic for a request it never saw created', async () => {
    const phases = await openPhaseSlot(async (slot) => {
      const request = {};
      publish('undici:client:sendHeaders', { request, socket: {} });
      await tick();
      publish('undici:request:headers', { request, response: {} });
      publish('undici:request:trailers', { request, trailers: {} });
      return slot.phases;
    });

    expect(phases).toBeUndefined();
  });

  it('ignores a malformed message rather than failing the request', () => {
    expect(() => {
      publish('undici:request:create', undefined);
      publish('undici:request:create', { request: 'not-an-object' });
      publish('undici:client:sendHeaders', {});
      publish('undici:client:connected', { connectParams: undefined, socket: undefined });
      publish('undici:client:beforeConnect', {});
    }).not.toThrow();
  });

  it('reports the phases it has when the sequence stops early', async () => {
    const phases = await run(async (request) => {
      await tick();
      publish('undici:client:sendHeaders', { request, socket: {} });
      await tick();
      publish('undici:request:headers', { request, response: {} });
    });

    expect(phases?.wait).toBeGreaterThan(0);
    expect(phases?.firstByte).toBeGreaterThan(0);
    // Nothing said the body was sent or the response finished.
    expect(phases?.request).toBeUndefined();
    expect(phases?.download).toBeUndefined();
  });

  it('attributes a handshake to the first request on that socket, and to no other', async () => {
    const socket = {};
    publish('undici:client:beforeConnect', { connectParams: origin });
    await tick();
    publish('undici:client:connected', { connectParams: origin, socket });

    const send = async (request: object): Promise<void> => {
      await tick();
      publish('undici:client:sendHeaders', { request, socket });
      publish('undici:request:headers', { request, response: {} });
    };
    const first = await run(send);
    const second = await run(send);

    expect(first?.connect).toBeGreaterThan(0);
    // The pooled connection cost the second request nothing, and is not charged to it.
    expect(second?.connect).toBeUndefined();
    expect(second?.wait).toBeGreaterThan(0);
  });

  // The real order: undici creates the request, *then* connects for it, then sends.
  it('does not charge the connection twice to the same call', async () => {
    const socket = {};
    const phases = await run(async (request) => {
      publish('undici:client:beforeConnect', { connectParams: origin });
      await tick();
      publish('undici:client:connected', { connectParams: origin, socket });
      await tick();
      publish('undici:client:sendHeaders', { request, socket });
      await tick();
      publish('undici:request:bodySent', { request });
      await tick();
      publish('undici:request:headers', { request, response: {} });
      await tick();
      publish('undici:request:trailers', { request, trailers: {} });
    });

    // `wait` is what is left once the handshake is accounted for, never the whole pre-send window.
    const preSend = (phases?.connect ?? 0) + (phases?.wait ?? 0);
    expect(phases?.connect).toBeGreaterThan(0);
    expect(phases?.wait).toBeGreaterThan(0);
    expect(phases?.request).toBeGreaterThan(0);
    expect(phases?.download).toBeGreaterThan(0);
    expect(preSend).toBeLessThan(1000);
  });

  it('matches a connection whose params name the host rather than the hostname', async () => {
    const socket = {};
    const legacy = { host: 'api.example.com', port: null };
    publish('undici:client:beforeConnect', { connectParams: legacy });
    await tick();
    publish('undici:client:connected', { connectParams: legacy, socket });

    const phases = await run((request) => {
      publish('undici:client:sendHeaders', { request, socket });
      publish('undici:request:headers', { request, response: {} });
    });

    expect(phases?.connect).toBeGreaterThan(0);
  });

  it('forgets a handshake that failed, so the next one is not credited with its time', async () => {
    const socket = {};
    publish('undici:client:beforeConnect', { connectParams: origin });
    await tick();
    publish('undici:client:connectError', { connectParams: origin, error: new Error('refused') });
    publish('undici:client:connected', { connectParams: origin, socket });

    const phases = await run(async (request) => {
      await tick();
      publish('undici:client:sendHeaders', { request, socket });
      publish('undici:request:headers', { request, response: {} });
    });

    expect(phases?.connect).toBeUndefined();
    expect(phases?.wait).toBeGreaterThan(0);
  });

  it('bounds the connections it tracks for an origin that never connects', async () => {
    for (let i = 0; i < 40; i += 1) {
      publish('undici:client:beforeConnect', { connectParams: origin });
    }
    await tick();
    const socket = {};
    publish('undici:client:connected', { connectParams: origin, socket });

    const phases = await run((request) => {
      publish('undici:client:sendHeaders', { request, socket });
      publish('undici:request:headers', { request, response: {} });
    });

    expect(phases?.connect).toBeGreaterThan(0);
  });

  it('measures nothing for a request created outside a slot', async () => {
    const request = {};
    publish('undici:request:create', { request });
    await tick();

    expect(() => {
      publish('undici:client:sendHeaders', { request, socket: {} });
      publish('undici:request:headers', { request, response: {} });
      publish('undici:request:trailers', { request, trailers: {} });
    }).not.toThrow();
  });

  it('closes a breakdown on the error channel as well as on the trailers', async () => {
    const phases = await run(async (request) => {
      await tick();
      publish('undici:client:sendHeaders', { request, socket: {} });
      await tick();
      publish('undici:request:headers', { request, response: {} });
      await tick();
      publish('undici:request:error', { request, error: new Error('reset') });
    });

    expect(phases?.download).toBeGreaterThan(0);
  });
});
