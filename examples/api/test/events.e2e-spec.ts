import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Profile } from '@eleven-labs/nest-profiler';
import { EVENT_ENTRYPOINT_TYPE } from '@eleven-labs/nest-profiler-event-emitter';
import type { EventEntrypointData, EventEntry } from '@eleven-labs/nest-profiler-event-emitter';
import { createE2EApp, profileOf, server } from './helpers/app.js';
import { readStoredProfiles } from './helpers/storage.js';

const eventEntries = (collectors: Record<string, unknown>): EventEntry[] =>
  (collectors['event-emitter'] as EventEntry[] | undefined) ?? [];

/**
 * Finds the `event` profile written for one listener execution. The profiler saves it off the
 * response path, so poll the shared storage briefly — the emitting request may well have answered
 * before the handler's own profile landed.
 */
async function findEventProfile(event: string): Promise<Profile<EventEntrypointData>> {
  for (let attempt = 0; ; attempt++) {
    const profiles = await readStoredProfiles();
    const match = profiles
      .filter(
        (p) =>
          p.entrypoint.type === EVENT_ENTRYPOINT_TYPE &&
          (p.entrypoint.data as EventEntrypointData).event === event,
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (match) return match as Profile<EventEntrypointData>;
    if (attempt >= 20) throw new Error(`no event profile recorded for "${event}"`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Domain events (e2e) — event-emitter collector', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2EApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('records the emission in the publishing request Events panel', async () => {
    const { res, profile } = await profileOf(app, 'post', '/api/v1/products', {
      name: 'Event-emitting product',
      price: 19.99,
    });
    expect(res.status).toBe(201);

    const entries = eventEntries(profile.collectors);
    const created = entries.find((e) => e.event === 'product.created');
    expect(created).toBeDefined();
    // Published through `emitAsync`, so the entry is flagged async and timed over the handlers.
    expect(created?.async).toBe(true);
    expect(created?.error).toBeUndefined();
    // The listener is subscribed, and `emitAsync` awaited its ~25ms of simulated work.
    expect(created?.listenerCount).toBeGreaterThanOrEqual(1);
    expect(created?.duration).toBeGreaterThanOrEqual(0);
  });

  it('captures the emitted payload', async () => {
    const { profile } = await profileOf(app, 'post', '/api/v1/products', {
      name: 'Payload probe',
      price: 5,
    });

    const created = eventEntries(profile.collectors).find((e) => e.event === 'product.created');
    expect(created?.payload).toMatchObject({ name: 'Payload probe', price: 5 });
  });

  it('does not record an Events panel on a request that emits nothing', async () => {
    const { profile } = await profileOf(app, 'get', '/api/v1/products');
    expect(eventEntries(profile.collectors)).toEqual([]);
  });

  it('profiles the @OnEvent handler execution as its own event entrypoint', async () => {
    await profileOf(app, 'post', '/api/v1/products', { name: 'Listener probe', price: 42 });

    const eventProfile = await findEventProfile('product.created');
    expect(eventProfile.entrypoint.data).toMatchObject({
      event: 'product.created',
      provider: 'NotificationListener',
      method: 'onProductCreated',
      success: true,
    });
    expect(eventProfile.response).toMatchObject({ statusCode: 200 });
    expect(eventProfile.performance.duration).toBeGreaterThanOrEqual(0);
    // The handler ran its own logs inside its own profile, not the request's.
    expect(eventProfile.logs.map((l) => l.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('product.created')]),
    );
  });

  it('lists the event profile in its own view of the profiler UI', async () => {
    await profileOf(app, 'post', '/api/v1/products', { name: 'UI probe', price: 7 });
    const eventProfile = await findEventProfile('product.created');

    // The home page links to the Events list…
    const home = await request(server(app)).get('/_profiler');
    expect(home.text).toContain('view=event');

    // …and that view renders the listener execution.
    const res = await request(server(app)).get('/_profiler').query({ view: 'event' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('product.created');
    expect(res.text).toContain(eventProfile.token.slice(0, 8));
    expect(res.text).toContain('NotificationListener');
  });

  it('exposes the @OnEvent subscriptions in the Routes panel', async () => {
    const res = await request(server(app)).get('/_profiler').query({ view: 'routes' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Event Listeners');
    expect(res.text).toContain('NotificationListener');
    expect(res.text).toContain('product.created');
  });
});
