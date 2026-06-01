# @eleven-labs/nest-profiler-axios

`@eleven-labs/nest-profiler-axios` captures outgoing HTTP requests made via `@nestjs/axios`'s `HttpService` and displays them in a dedicated **HTTP Client** panel.

![HTTP Client panel — outgoing requests via HttpService with method, URL, status and duration](../../docs/public/screenshots/profiler/http-client.png)

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
