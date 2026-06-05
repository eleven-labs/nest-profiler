import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';

/**
 * Recreates the `products` schema for the example on startup (outside production). Uses
 * `refresh()` (drop + create) so switching `SQL_ORM` against the shared table — which each ORM
 * maps slightly differently — always starts clean. Runs in `onModuleInit`, before the application
 * service seeds data in `onApplicationBootstrap`.
 */
@Injectable()
export class MikroOrmSchemaInitializer implements OnModuleInit {
  private readonly logger = new Logger(MikroOrmSchemaInitializer.name);

  constructor(private readonly orm: MikroORM) {}

  async onModuleInit(): Promise<void> {
    if (process.env['NODE_ENV'] === 'production') return;
    await this.orm.schema.refresh();
    this.logger.log('MikroORM schema refreshed');
  }
}
