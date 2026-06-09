# @eleven-labs/nest-profiler-axios

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
  <a href="https://codecov.io/gh/eleven-labs/nest-profiler/flags"><img alt="Coverage" src="https://codecov.io/gh/eleven-labs/nest-profiler/branch/main/graph/badge.svg?flag=nest-profiler-axios" /></a>
  <a href="https://nest-profiler.eleven-labs.com/docs/packages/nest-profiler-axios"><img alt="Documentation" src="https://img.shields.io/badge/docs-nest--profiler.eleven--labs.com-e5225a" /></a>
  <img alt="Node &gt;= 22" src="https://img.shields.io/badge/node-%3E%3D22-3c873a" />
  <img alt="Built with NestJS" src="https://img.shields.io/badge/built%20with-NestJS-ea2845" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" />
  <img alt="Code style: Prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" />
</p>

`@eleven-labs/nest-profiler-axios` captures outgoing HTTP requests made via `@nestjs/axios`'s `HttpService` and displays them in a dedicated **HTTP Client** panel.

![HTTP Client panel — outgoing requests via HttpService with method, URL, status and duration](https://raw.githubusercontent.com/eleven-labs/nest-profiler/main/docs/public/screenshots/profiler/http-client.png)

## Installation

```bash
pnpm add @eleven-labs/nest-profiler-axios @nestjs/axios axios
```

**Peer dependencies:** `axios ^1.0.0`, `@nestjs/axios ^4.0.0`

## Setup

`AxiosCollectorModule` imports and re-exports `HttpModule`, so you **do not** need to import `HttpModule` separately:

```ts title="app.module.ts"
import { AxiosCollectorModule } from '@eleven-labs/nest-profiler-axios';

@Module({
  imports: [
    // replaces HttpModule — provides HttpService and patches axios interceptors
    AxiosCollectorModule.forRoot(),
    ProfilerModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}
```

Inject `HttpService` in your services as usual:

```ts
import { HttpService } from '@nestjs/axios';

@Injectable()
export class WeatherService {
  constructor(private readonly http: HttpService) {}

  async getForecast() {
    const response = await firstValueFrom(
      this.http.get('https://api.weather.example.com/forecast'),
    );
    return response.data;
  }
}
```

## What it collects

For each outgoing request:

| Field        | Description                     |
| ------------ | ------------------------------- |
| `method`     | HTTP method (GET, POST, …)      |
| `url`        | Full request URL                |
| `statusCode` | Response status code            |
| `duration`   | Request duration in ms          |
| `startedAt`  | Unix timestamp                  |
| `error`      | Error message if request failed |

## Toolbar badge

`{n}req` (e.g., `3req`). When errors are present: `3req (1 err)`.

## How it works

At module initialization, the collector registers axios request/response interceptors on the `HttpService`'s internal `axiosRef`. The interceptors record start time and push an entry to the current request profile once the response arrives.

---

Part of the [nest-profiler](https://github.com/eleven-labs/nest-profiler) toolkit · Powered & maintained by [Eleven Labs](https://eleven-labs.com)
