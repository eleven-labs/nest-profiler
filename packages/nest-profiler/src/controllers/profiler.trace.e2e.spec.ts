import type { Server } from 'node:http';
import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProfilerModule } from '../nest-profiler.module';
import { TracerService } from '../services/tracer.service';
import { createProfilerLogger } from '../services/profiler-logger-adapter';

/**
 * Profiles sharing a trace id are one unit of work — a request and the events or messages it set
 * off — yet each detail page used to show its own profile only. A line logged by the request's
 * exception filter after an event listener failed was invisible from the listener's profile.
 */

const logger = createProfilerLogger({ log: jest.fn() }, { attachTraceIdToLogs: false });

@Controller()
class TraceController {
  @Get('/orders')
  orders(): string {
    logger.log('Listing the orders', 'OrdersController');
    return 'ok';
  }

  @Get('/invoices')
  invoices(): string {
    logger.log('Listing the invoices', 'InvoicesController');
    return 'ok';
  }
}

describe('profiles of the same trace', () => {
  let app: INestApplication;
  let orders: string;
  let invoices: string;
  let unrelated: string;

  async function profiled(path: string, traceId: string): Promise<string> {
    const res = await request(app.getHttpServer() as Server)
      .get(path)
      .set('x-request-id', traceId);
    return res.headers['x-debug-token'] as string;
  }

  async function detail(query: string): Promise<string> {
    const res = await request(app.getHttpServer() as Server).get(`/_profiler/${query}`);
    expect(res.status).toBe(200);
    return res.text;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProfilerModule.forRoot()],
      controllers: [TraceController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    orders = await profiled('/orders', 'trace-shared');
    invoices = await profiled('/invoices', 'trace-shared');
    unrelated = await profiled('/orders', 'trace-other');
    // Persistence is deferred off the response path — drain it before reading the profiles.
    await app.get(TracerService).flush();
  });

  afterAll(async () => await app.close());

  it('lists the profiles of the trace in the sidebar', async () => {
    const html = await detail(orders);

    expect(html).toContain('>Trace</span>');
    expect(html).toContain(`/_profiler/${invoices}`);
    expect(html).not.toContain(`/_profiler/${unrelated}`);
  });

  it('keeps the active tab on the links to the other profiles of the trace', async () => {
    const html = await detail(`${orders}?tab=exceptions`);

    expect(html).toContain(`/_profiler/${invoices}?tab=exceptions`);
  });

  it('shows no trace section for a profile alone in its trace', async () => {
    const html = await detail(unrelated);

    expect(html).not.toContain('>Trace</span>');
  });

  it('shows only the lines of the profile by default', async () => {
    const html = await detail(`${orders}?tab=logs`);

    expect(html).toContain('Listing the orders');
    expect(html).not.toContain('Listing the invoices');
    expect(html).toContain('Whole trace · 2 profiles');
  });

  it('merges the lines of the whole trace on demand, naming the profile of each', async () => {
    const html = await detail(`${orders}?tab=logs&scope=trace`);

    expect(html).toContain('Listing the orders');
    expect(html).toContain('Listing the invoices');
    expect(html).toContain(`/_profiler/${invoices}?tab=logs&amp;scope=trace`);
  });
});
