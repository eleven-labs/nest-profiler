import * as path from 'path';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { ProfilerCollector, isPlainObject, redact, tryResolve } from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, Profile, SecurityContext } from '@eleven-labs/nest-profiler';
import { AUTH_COLLECTOR_OPTIONS } from './auth-collector.module';
import type { AuthCollectorModuleOptions } from './auth-collector.module';

const AUTH_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L2 4v4c0 3.3 2.5 6.4 6 7 3.5-.6 6-3.7 6-7V4L8 1z" opacity="0.9"/></svg>`;

@ProfilerCollector({ name: 'auth', label: 'Security', icon: AUTH_ICON, priority: 40 })
@Injectable()
export class AuthCollector implements IProfilerCollector, OnModuleInit {
  readonly name = 'auth';
  readonly label = 'Security';
  readonly icon = AUTH_ICON;
  readonly priority = 40;

  /** Resolved lazily so a disabled core (no ClsModule) degrades to a no-op instead of a DI crash. */
  private cls: ClsService | undefined;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(AUTH_COLLECTOR_OPTIONS)
    private readonly options: AuthCollectorModuleOptions = {},
  ) {}

  onModuleInit(): void {
    this.cls = tryResolve<ClsService>(this.moduleRef, ClsService);
  }

  getBadgeValue(profile: Profile): string | null {
    const sec = profile.security;
    if (!sec) return null;
    if (!sec.isAuthenticated) return 'anon';
    const user = sec.user;
    if (user) {
      const identifier = user['username'] ?? user['email'] ?? user['sub'] ?? user['id'];
      if (typeof identifier === 'string') return identifier;
      if (typeof identifier === 'number') return String(identifier);
    }
    return 'auth';
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'auth-panel.ejs');
  }

  collect(profile: Profile): SecurityContext {
    interface AuthRequest {
      user?: Record<string, unknown>;
      headers?: Record<string, string | string[]>;
    }
    let request: AuthRequest | undefined;
    try {
      request = this.cls?.get<AuthRequest | undefined>('profiler.request');
    } catch {
      // Outside CLS
    }

    const user = request?.user;
    const authHeader = request?.headers?.['authorization'];
    const authHeaderStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const rawClaims = authHeaderStr ? this.decodeJwt(authHeaderStr) : undefined;
    const roles = this.extractRoles(user);

    const context: SecurityContext = {
      isAuthenticated: !!user,
      user: user ? this.maskUser(user) : undefined,
      roles,
      // JWT claims may carry sensitive custom claims — redact them (standard claims like
      // `sub`/`iat`/`exp` are preserved; only sensitive keys/values are masked).
      jwtClaims: rawClaims ? redact(rawClaims) : undefined,
    };

    profile.security = context;
    return context;
  }

  private extractRoles(user: Record<string, unknown> | undefined): string[] | undefined {
    if (!user) return undefined;
    const raw = user['roles'] ?? user['role'];
    if (Array.isArray(raw)) return raw.map((r) => this.roleToString(r));
    if (typeof raw === 'string') return [raw];
    return undefined;
  }

  /** Maps a role entry to a display string, handling role objects like `{ name: 'admin' }`. */
  private roleToString(role: unknown): string {
    if (typeof role === 'string') return role;
    if (isPlainObject(role)) {
      const label = role['name'] ?? role['role'] ?? role['id'];
      if (typeof label === 'string') return label;
      if (typeof label === 'number') return String(label);
    }
    return String(role);
  }

  private decodeJwt(authHeader: string): Record<string, unknown> | undefined {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const parts = token.split('.');
    const payloadSegment = parts[1];
    if (parts.length !== 3 || payloadSegment === undefined) return undefined;
    try {
      const payload = Buffer.from(payloadSegment, 'base64url').toString('utf-8');
      const parsed: unknown = JSON.parse(payload);
      return isPlainObject(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private maskUser(user: Record<string, unknown>): Record<string, unknown> {
    // Recursive redaction so nested secrets (`user.credentials.apiKey`) are masked too, plus
    // any extra field names the host lists via `maskUserFields`.
    return redact(user, { maskKeys: this.options.maskUserFields ?? [] });
  }
}
