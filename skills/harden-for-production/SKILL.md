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

1. **Access control — provide a `security` strategy (required).** The profiler is **open by default** — there is no built-in token any more. In production you MUST lock `/_profiler/*` down via the `security` option — it is the only gate. Pick what fits the app:
   - **Reuse an existing app guard** — `security: { guards: [JwtAuthGuard] }` (a NestJS `CanActivate`, resolved through DI; use `forRootAsync` if it needs injected services). Best when the app already authenticates admins; stays browser-navigable if the guard also reads a cookie.
   - **`authorize` predicate** — `(ctx) => boolean | Promise<boolean>` over `ctx.request` / `ctx.response`. For HTTP Basic, set `ctx.response.setHeader('WWW-Authenticate', 'Basic realm="Profiler"')` before returning `false` so the browser prompts; the browser then re-sends the credential on every link.
   - **Bearer / `?token=`** — check the header or query in `authorize`, and add `security.linkQuery` to thread `?token=` across UI links (a bare Bearer header can't ride a browser link click). Compare secrets with `timingSafeEqual`.
   - Several strategies ⇒ **all must pass**. Never commit the credential — read it from the deploy environment via your own `security` code (the profiler defines no auth env var).
2. **Keep gating explicit.** Confirm the enable predicate is off-by-default (`enabled('PROFILER_ENABLED')`, unset ⇒ off) so a forgotten variable means off. Prefer Approach A (`ConditionalModule`) so the profiler module never even loads when off.
3. **Don't capture bodies.** `collectBody: false` (the default). If some bodies are needed, cap with a small `maxBodySize` and rely on masking.
4. **Mask sensitive data.** Extend the core's `redaction` block (`headers`, `cookies`, `queryParams`, `keys`, `patterns`) — every list is additive over the built-ins — and the per-collector masks: `maskKeys` (config), `maskUserFields` (auth), `maskHeaders` (http, rabbitmq). Verify auth/JWT fields and DB credentials are covered.
5. **Cap what the AI panel stores.** `@eleven-labs/nest-profiler-ai` records prompts, completions, reasoning and tool payloads — the one capture path that holds free-form user data, retrieved documents and the credentials a tool was handed. It masks them by default (`capture: 'redacted'`); confirm nothing has set `capture: 'full'` (the module logs a warning at startup when something has), and go further where the prompts carry regulated data: `capture: 'metadata'` keeps the shape only, `capture: 'none'` keeps just the figures, and a per-field object narrows one at a time — `instructions`, `messages`, `completion`, `reasoning`, `toolDefinitions`, `toolArguments`, `toolResults`, `output`, with `prompt` and `tools` as shorthands (`{ default: 'redacted', prompt: 'metadata', toolResults: 'none' }`). Leave `runtimeContext` alone unless the tool context is needed: it is opt-in and holds the user, the tenant and whatever token the tools were handed. Likewise `providerPayload`, the raw provider bodies: opt-in, and it restates the whole prompt at every step. Extend the masking with `redaction` (`keys`, `patterns`, `pii`, or a `sanitize` scrubber of your own).
6. **Sample and cap retention.** Lower `sampleRate` (e.g. `0.05`) to profile a fraction of traffic; keep `maxProfiles` and `ttl` small so stored data stays bounded.
7. **Skip sensitive routes.** Use `ignorePaths` / `ignoreRequest` (compose with `combineFilters(...)`) for auth, payment, webhook and PII endpoints.
8. **Mind persistence.** With `file` / `sqlite` storage, profiles land on disk under `storagePath`. Ensure that path is **not web-served**, is on writable ephemeral or a locked-down volume, is in `.gitignore`, and is cleaned up (short `ttl`, small `maxProfiles`).

## Verify

- With `PROFILER_ENABLED` unset (production default), confirm the app boots and `/_profiler` is **not** served (Approach A) or is inert (Approach B).
- With the profiler on **and** a `security` strategy configured, confirm `curl -i /_profiler` with no credential is `401`, and that a valid credential renders (`curl -u user:pass` for Basic, `Authorization: Bearer <token>` or `?token=` for a token, the app cookie for a reused guard). Static assets under `__assets/*` stay reachable.
- With the AI collector on, send a prompt carrying an email address or a token and confirm the AI panel shows it masked (and says which capture level the profile was taken at).
- Trigger a request with a secret header/cookie and confirm the captured profile shows it masked (`[REDACTED]`, or whatever `redaction.replacement` you set), and that no body is captured when `collectBody: false`.

Full option reference and the same checklist: <https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration>
