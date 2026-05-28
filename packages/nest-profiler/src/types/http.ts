import type { IncomingMessage, ServerResponse } from 'node:http';

/** Minimal request surface shared by both Express and Fastify NestJS adapters. */
export interface PlatformRequest extends IncomingMessage {
  method: string;
  url: string;
  /** Set by Express adapter only. */
  originalUrl?: string;
  /** Set by Express adapter only. */
  path?: string;
  ip?: string;
  query?: Record<string, string | string[]>;
  body?: unknown;
  /** Set by cookie middleware (e.g. cookie-parser / @fastify/cookie). */
  cookies?: Record<string, string>;
  /** Set by session middleware (e.g. express-session / @fastify/session). */
  session?: Record<string, unknown>;
}

export interface PlatformResponse extends ServerResponse {
  getHeaders(): Record<string, string | number | string[]>;
}

export type NextFunction = (err?: unknown) => void;
