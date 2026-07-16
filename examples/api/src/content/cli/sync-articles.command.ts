import { ConsoleLogger } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';
import { createProfilerLogger } from '@eleven-labs/nest-profiler';
import { ArticleService } from '../application/article.service.js';

interface SyncArticlesOptions {
  limit?: number;
}

const CLI_CACHE_KEY = 'cli:articles';

/**
 * Fetches articles from the external API (via the selected HTTP client) and caches them — reusing
 * the same {@link ArticleService} as the REST controller. Running it produces a CLI profile that
 * shows the **Command**, **HTTP Client** and **Cache** panels together.
 */
@Command({
  name: 'content:sync',
  description: 'Fetch articles from an external API and cache them',
})
export class SyncArticlesCommand extends CommandRunner {
  // Wrap a console logger so log lines are captured into the active profile — no ProfilerService
  // injection needed, so the command resolves cleanly whether the profiler is on or off.
  private readonly logger: LoggerService = createProfilerLogger(
    new ConsoleLogger(SyncArticlesCommand.name),
  );

  constructor(private readonly articles: ArticleService) {
    super();
  }

  async run(_passedParams: string[], options?: SyncArticlesOptions): Promise<void> {
    const limit = options?.limit ?? 5;
    this.logger.log(`Fetching ${limit} article(s) from the external API…`);
    const count = await this.articles.syncArticles(limit, CLI_CACHE_KEY);
    this.logger.log(`Cached ${count} article(s) under "${CLI_CACHE_KEY}".`);
  }

  @Option({ flags: '-l, --limit <limit>', description: 'Number of articles to fetch (default: 5)' })
  parseLimit(value: string): number {
    return parseInt(value, 10);
  }
}
