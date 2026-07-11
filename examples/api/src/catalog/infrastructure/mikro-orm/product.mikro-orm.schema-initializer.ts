import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MikroORM } from '@mikro-orm/core';

/**
 * Ensures the `products` schema exists for the example on startup, before the application service
 * seeds data in `onApplicationBootstrap`. Driven by the same `database.synchronize` /
 * `database.dropSchema` config as the TypeORM adapter (see database.config.ts): `dropSchema` uses
 * `refresh()` (drop + create) so switching `SQL_ORM` against the shared table — which each ORM maps
 * slightly differently — starts clean; otherwise `synchronize` uses the non-destructive `update()`
 * so a hosted deploy (Vercel + Neon) gets its table created but kept across cold starts.
 */
@Injectable()
export class MikroOrmSchemaInitializer implements OnModuleInit {
  private readonly logger = new Logger(MikroOrmSchemaInitializer.name);

  constructor(
    private readonly orm: MikroORM,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<boolean>('database.dropSchema')) {
      await this.orm.schema.refresh();
      this.logger.log('MikroORM schema refreshed');
    } else if (this.config.get<boolean>('database.synchronize')) {
      await this.orm.schema.update();
      this.logger.log('MikroORM schema updated');
    }
  }
}
