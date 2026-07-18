---
name: harden-for-production
description: |
  Harden an existing @eleven-labs/nest-profiler setup for a production (or production-like) environment.
  Applies the access-control, masking, sampling, retention and persistence checklist so the profiler can run outside local dev without leaking sensitive data.
  Use when a user wants the profiler enabled in production, on a shared/staging environment, or reachable beyond localhost — or asks how to make an existing setup safe.
---

# Harden nest-profiler for production

The profiler exposes request headers, query params, bodies and logs through the `/_profiler` UI. Off in local dev that is a feature; anywhere reachable by others it is a data-exposure risk. This skill makes an **already-configured** profiler safe to run outside dev.

**Core profiler not set up yet?** → use `setup-nest-profiler` first (it wires the enable strategy and collectors). This skill assumes a working `ProfilerModule` and only hardens it.

First, state the stance plainly: **keep the profiler off in production by default.** Enabling it is legitimate when the API is not publicly reachable (internal, behind a VPN) or the user has accepted the exposure — don't refuse, harden it. Confirm the user's intent before changing anything.

## Checklist

Apply each, driven from `ConfigService`/env where the app already does so:

1. **Access control — provide a `security` strategy (required).** The profiler is **open by default** — there is no built-in token any more. In production you MUST lock `/_profiler/*` down via the `security` option; this is the real gate, the `path` value is not security. Pick what fits the app:
   - **Reuse an existing app guard** — `security: { guards: [JwtAuthGuard] }` (a NestJS `CanActivate`, resolved through DI; use `forRootAsync` if it needs injected services). Best when the app already authenticates admins; stays browser-navigable if the guard also reads a cookie.
   - **`authorize` predicate** — `(ctx) => boolean | Promise<boolean>` over `ctx.request` / `ctx.response`. For HTTP Basic, set `ctx.response.setHeader('WWW-Authenticate', 'Basic realm="Profiler"')` before returning `false` so the browser prompts; the browser then re-sends the credential on every link.
   - **Bearer / `?token=`** — check the header or query in `authorize`, and add `security.linkQuery` to thread `?token=` across UI links (a bare Bearer header can't ride a browser link click). Compare secrets with `timingSafeEqual`.
   - Several strategies ⇒ **all must pass**. Never commit the credential — read it from the deploy environment via your own `security` code (the profiler defines no auth env var).
2. **Keep gating explicit.** Confirm the enable predicate is off-by-default (`enabled('PROFILER_ENABLED')`, unset ⇒ off) so a forgotten variable means off. Prefer Approach A (`ConditionalModule`) so the profiler module never even loads when off. If the app wires the GraphQL field middleware (`createProfilerFieldMiddleware`), gate it too — it lives in the GraphQL schema, not the profiler module, so `ConditionalModule` can't strip it: register it as `fieldMiddleware: isProfilerEnabled ? [createProfilerFieldMiddleware()] : []` so graphql-js runs nothing per field when off.
3. **Don't capture bodies.** `collectBody: false` (the default). If some bodies are needed, cap with a small `maxBodySize` and rely on masking.
4. **Mask sensitive data.** Add `maskHeaders` / `maskCookies` on the core, and the per-collector masks: `maskKeys` (config), `maskUserFields` (auth), `maskHeaders` (http, rabbitmq). Verify auth/JWT fields and DB credentials are covered.
5. **Sample and cap retention.** Lower `sampleRate` (e.g. `0.05`) to profile a fraction of traffic; keep `maxProfiles` and `ttl` small so stored data stays bounded.
6. **Skip sensitive routes.** Use `ignorePaths` / `ignoreRequest` (compose with `combineFilters(...)`) for auth, payment, webhook and PII endpoints.
7. **Mind persistence.** With `file` / `sqlite` storage, profiles land on disk under `storagePath`. Ensure that path is **not web-served**, is on writable ephemeral or a locked-down volume, is in `.gitignore`, and is cleaned up (short `ttl`, small `maxProfiles`).

## Verify

- With `PROFILER_ENABLED` unset (production default), confirm the app boots and `/_profiler` is **not** served (Approach A) or is inert (Approach B).
- With the profiler on **and** a `security` strategy configured, confirm `curl -i /_profiler` with no credential is `401`, and that a valid credential renders (`curl -u user:pass` for Basic, `Authorization: Bearer <token>` or `?token=` for a token, the app cookie for a reused guard). Static assets under `__assets/*` stay reachable.
- Trigger a request with a secret header/cookie and confirm the captured profile shows it masked (`[REDACTED]` / `***`), and that no body is captured when `collectBody: false`.

Full option reference and the same checklist: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration>
