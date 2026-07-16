# @eleven-labs/nest-profiler-commander

<p align="center">
  <a href="https://eleven-labs.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-white.svg">
      <img alt="Powered &amp; maintained by Eleven Labs" src="https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/assets/eleven-labs-dark.svg" width="180">
    </picture>
  </a>
</p>

<p align="center"><em>Powered &amp; maintained by <a href="https://eleven-labs.com">Eleven Labs</a></em></p>

<p align="center">
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml"><img alt="Quality" src="https://github.com/eleven-labs/nest-profiler/actions/workflows/quality.yml/badge.svg" /></a>
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-commander" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-commander"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-commander` profiles CLI commands built with [nest-commander](https://nest-commander.jaymcdoniel.dev/) — the console equivalent of Symfony's command profiling. Every command run produces a profile that shows up in the web profiler at `/_profiler`, in a dedicated **Commands** table and with a built-in **Command** tab, plus any HTTP, cache, or database activity the command triggered.

![Commands view — every profiled CLI command with its status, exit code and duration](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/command-list.png)

![Command tab — a profiled nest-commander run with its arguments, options and exit code](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/command.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-commander@alpha nest-commander
```

> There is no stable release yet — install every `@eleven-labs/nest-profiler*` package with the `@alpha` dist-tag (`@latest` resolves to nothing).

**Peer dependencies:** `nest-commander ^3.20.0`

## Setup

The collector wraps every discovered command automatically — you do not change your command classes. Register it in the module you bootstrap with `CommandFactory`:

```ts title="cli.module.ts"
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { CommanderCollectorModule } from '@eleven-labs/nest-profiler-commander';
import { AppCommand } from './app.command';

const isProfilerEnabled = (env: NodeJS.ProcessEnv) => env['PROFILER_ENABLED'] === 'true';

@Module({
  imports: [ConditionalModule.registerWhen(CommanderCollectorModule.forRoot(), isProfilerEnabled)],
  providers: [AppCommand],
})
export class CliModule {}
```

> **Enabling / disabling** — gate the collector with `ConditionalModule.registerWhen(..., isProfilerEnabled)` as shown, so it loads only when `PROFILER_ENABLED` is on. Wire the core `ProfilerModule` **once at the CLI root** — use `storageType: 'file'` so the CLI process and the HTTP server share the same profiles. The recommended setup bundles the root-level profiler modules into a single `ProfilingModule` behind two `ConditionalModule` gates (see [Enabling and disabling the profiler](https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler/configuration#enabling-and-disabling-the-profiler) and the [example app](https://nest-profiler.eleven-labs.com/docs/example-api)). A top-level `enabled` option is also supported as an alternative.

```ts title="cli.ts"
import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli.module';

async function bootstrap(): Promise<void> {
  await CommandFactory.run(CliModule, { logger: ['error', 'warn'] });
}

void bootstrap();
```

Run a command, then open `/_profiler` on your HTTP app (pointed at the same `storagePath`) to inspect it.

> **Cross-process storage required.** The CLI and the web server are separate processes, so command profiles are only visible in the server when both share the backing store — use `storageType: 'file'` (or a Redis/DB adapter). In-memory storage is per-process; the profiler logs a warning if you profile a command against it.

## What it collects

Each command run sets a `command` entrypoint on the profile (`entrypoint.type = 'command'`, with this payload on `entrypoint.data`):

| Field       | Description                                    |
| ----------- | ---------------------------------------------- |
| `name`      | Command name from `@Command({ name })`         |
| `arguments` | Positional parameters (`passedParams`)         |
| `options`   | Parsed flag options                            |
| `exitCode`  | `0` on success, `1` when the command threw     |
| `success`   | Whether the command completed without throwing |

Duration and timing come from the profile's standard performance data, and a thrown error appears in the **Exceptions** tab. Because the command body runs inside the profiler's CLS context, profile-scoped collectors (e.g. `@eleven-labs/nest-profiler-http`, `@eleven-labs/nest-profiler-cache`) capture the work a command performs and contribute their own panels.

## How it works

At application bootstrap the module discovers every provider that is an instance of nest-commander's `CommandRunner` and wraps its `run()` method. The wrapper synthesises a profile with a `command` entrypoint (`entrypoint.type = 'command'`, the command details on `entrypoint.data`), opens a CLS context, runs the original command, then runs all collectors and saves the profile through the profiler's shared storage. The module registers the `command` entrypoint type with the profiler core, which renders command profiles in a dedicated Commands table and a built-in Command tab — import the module in your HTTP app too so cross-process command profiles render there. `nest-commander` is a required peer dependency of this package (it imports `CommandRunner` statically).

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
