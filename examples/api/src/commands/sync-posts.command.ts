import { ConsoleLogger, Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import { Command, CommandRunner, Option } from 'nest-commander';
import { ProfilerService } from '@eleven-labs/nest-profiler';

interface JphPost {
  userId: number;
  id: number;
  title: string;
  body: string;
}

interface SyncPostsOptions {
  limit?: number;
}

const POSTS_CACHE_KEY = 'cli:posts';

/**
 * Fetches posts from an external API (axios) and caches them. Running it produces a CLI
 * profile that shows the **Command**, **HTTP Client**, and **Cache** panels together —
 * the console equivalent of Symfony's command profiling.
 */
@Command({
  name: 'sync:posts',
  description: 'Fetch posts from an external API (axios) and cache them',
})
export class SyncPostsCommand extends CommandRunner {
  private readonly logger: LoggerService;

  constructor(
    private readonly http: HttpService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly profiler: ProfilerService,
  ) {
    super();
    // Wrap a console logger so log lines are captured into the active profile.
    this.logger = this.profiler.createLogger(new ConsoleLogger(SyncPostsCommand.name));
  }

  async run(_passedParams: string[], options?: SyncPostsOptions): Promise<void> {
    const limit = options?.limit ?? 5;

    this.logger.log(`Fetching ${limit} post(s) from the external API…`);
    const stop = this.profiler.startSpan('cli.sync-posts.fetch');
    const { data: posts } = await firstValueFrom(
      this.http.get<JphPost[]>(`https://jsonplaceholder.typicode.com/posts?_limit=${limit}`),
    );
    stop();

    await this.cache.set(POSTS_CACHE_KEY, posts, 60000);
    this.logger.log(`Cached ${posts.length} post(s) under "${POSTS_CACHE_KEY}".`);
  }

  @Option({
    flags: '-l, --limit <limit>',
    description: 'Number of posts to fetch (default: 5)',
  })
  parseLimit(value: string): number {
    return parseInt(value, 10);
  }
}
