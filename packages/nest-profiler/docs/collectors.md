Collectors are the units that turn an execution into panels: each active collector contributes one tab to the profile detail view. The built-in **Timeline** collector captures custom spans, and any provider can become a collector with the `@ProfilerCollector()` decorator — this page covers both.

## Timeline spans

Instrument any code with `startSpan()` to capture custom timing data in the **Timeline** panel:

```ts
import { ProfilerService } from '@eleven-labs/nest-profiler';

@Injectable()
export class UserService {
  constructor(private readonly profiler: ProfilerService) {}

  async findAll() {
    const stop = this.profiler.startSpan('db.findAll');
    const users = await this.userRepository.find();
    stop();
    return users;
  }
}
```

The built-in **Timeline collector** is always active and displays all spans as a visual bar chart.

![Timeline tab showing custom spans as synchronized bars](../../../docs/public/screenshots/profiler/timeline.png)

## Custom collectors

Annotate a provider with `@ProfilerCollector()` to automatically add a custom data panel to every profile. The collector is auto-discovered via NestJS `DiscoveryModule` — no manual registration required.

```ts
import { Injectable } from '@nestjs/common';
import { ProfilerCollector, IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import * as path from 'path';

const MY_ICON = `<svg viewBox="0 0 16 16" fill="currentColor">...</svg>`;

@Injectable()
@ProfilerCollector({
  name: 'myCollector',
  label: 'My Collector',
  icon: MY_ICON,
  priority: 50,
})
export class MyCollector implements IProfilerCollector {
  readonly name = 'myCollector';
  readonly label = 'My Collector';
  readonly icon = MY_ICON;
  readonly priority = 50;

  getBadgeValue(profile: Profile): string | null {
    // Return a value to display as a badge in the toolbar
    return '42';
  }

  getTemplatePath(): string {
    // Optional: path to a custom EJS panel template
    return path.join(__dirname, 'templates', 'my-collector-panel.ejs');
  }

  collect(profile: Profile): unknown {
    // Return any serializable data for this panel
    return { items: [] };
  }
}
```

Register the collector as a provider in your module — the profiler discovers it automatically at startup.

## Custom EJS panel template

When `getTemplatePath()` is defined, the profiler renders your custom EJS template instead of the default JSON dump. The template receives:

| Variable       | Type                       | Description                   |
| -------------- | -------------------------- | ----------------------------- |
| `data`         | `unknown`                  | Value returned by `collect()` |
| `profile`      | `Profile`                  | The full request profile      |
| `panel`        | `CollectorPanelInfo`       | Panel metadata (name, label…) |
| `highlightSql` | `(sql: string) => string`  | SQL syntax highlighter        |
| `toJson`       | `(val: unknown) => string` | JSON formatter                |
| `isoDate`      | `(ts: number) => string`   | ISO date formatter            |
| `timeOnly`     | `(ts: number) => string`   | Time-only formatter           |

> **Step-by-step tutorial** — [Build a custom collector](https://nest-profiler.eleven-labs.com/docs/tutorials/custom-collector) walks through writing a collector, its EJS panel and its badge from scratch.
