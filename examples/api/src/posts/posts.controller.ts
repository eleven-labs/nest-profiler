import { Body, Controller, Get, Inject, Optional, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpService } from '@nestjs/axios';
import type { Cache } from 'cache-manager';
import { firstValueFrom } from 'rxjs';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { CreatePostDto } from './dto/create-post.dto.js';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

const POSTS_CACHE_KEY = 'external:posts';
const TODOS_CACHE_KEY = 'external:todos';

interface JphPost {
  userId: number;
  id: number;
  title: string;
  body: string;
}

interface JphUser {
  id: number;
  name: string;
  username: string;
  email: string;
  company: { name: string };
}

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  // Only set when FEATURE_PINO_LOGGER=true; wrapped here because injected loggers bypass app.useLogger().
  private readonly logger?: PinoLogger;

  constructor(
    private readonly profiler: ProfilerService,
    private readonly http: HttpService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Optional()
    @InjectPinoLogger(PostsController.name)
    pinoLogger?: PinoLogger,
  ) {
    this.logger = pinoLogger ? this.profiler.createLogger(pinoLogger) : undefined;
  }

  @Get()
  @ApiOperation({
    summary:
      'Fetch posts enriched with author info — demonstrates multiple concurrent axios calls + cache',
    description:
      'First call: GET_MISS → fetches posts then resolves each author in parallel (N+1 HTTP calls) → SET. ' +
      'Subsequent calls: GET_HIT, no axios call.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Enriched posts with author — HTTP Client panel shows all outgoing calls on first request',
  })
  async getPosts(): Promise<unknown[]> {
    const cached = await this.cache.get<unknown[]>(POSTS_CACHE_KEY);
    if (cached) {
      this.logger?.info('Posts served from cache (HIT)');
      return cached;
    }

    // 1. Fetch posts
    this.logger?.info('Fetching posts from external API (MISS)');
    const stopPosts = this.profiler.startSpan('http.posts');
    const { data: posts } = await firstValueFrom(
      this.http.get<JphPost[]>('https://jsonplaceholder.typicode.com/posts?_limit=5'),
    );
    stopPosts();

    // 2. Resolve unique authors in parallel
    const userIds = [...new Set(posts.map((p) => p.userId))];
    const stopUsers = this.profiler.startSpan('http.posts.authors');
    const userResponses = await Promise.all(
      userIds.map((id) =>
        firstValueFrom(this.http.get<JphUser>(`https://jsonplaceholder.typicode.com/users/${id}`)),
      ),
    );
    stopUsers();

    const userMap = new Map(userResponses.map((r) => [r.data.id, r.data]));
    // pino convention: merging object first, then the message.
    this.logger?.info(
      { postCount: posts.length, authorCount: userMap.size, cacheKey: POSTS_CACHE_KEY },
      'Resolved authors, caching enriched posts',
    );

    // 3. Build enriched response and cache it
    const enriched = posts.map((post) => {
      const author = userMap.get(post.userId);
      return {
        ...post,
        author: author
          ? {
              id: author.id,
              name: author.name,
              username: author.username,
              email: author.email,
              company: author.company.name,
            }
          : null,
      };
    });

    await this.cache.set(POSTS_CACHE_KEY, enriched, 30000);
    return enriched;
  }

  @Post()
  @ApiOperation({
    summary: 'Create a post — demonstrates validator collector (valid & invalid DTOs)',
  })
  @ApiResponse({ status: 201, description: 'Post created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed — check the Validator panel in /_profiler',
  })
  createPost(@Body() dto: CreatePostDto): Record<string, unknown> {
    this.logger?.info(`Creating post: ${dto.title}`);
    return {
      id: Math.floor(Math.random() * 1000) + 100,
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      coverImageUrl: dto.coverImageUrl ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  @Post('forward')
  @ApiOperation({
    summary:
      'Forward a post to JSONPlaceholder via axios POST — shows request body, headers and response body in the HTTP Client panel',
  })
  @ApiResponse({
    status: 201,
    description:
      'Post forwarded — check the HTTP Client panel in /_profiler for full request/response details',
  })
  async forwardPost(@Body() dto: CreatePostDto): Promise<unknown> {
    this.logger?.info(`Forwarding post to external API: ${dto.title}`);
    const stop = this.profiler.startSpan('http.forward-post');
    const { data } = await firstValueFrom(
      this.http.post<unknown>('https://jsonplaceholder.typicode.com/posts', {
        title: dto.title,
        body: dto.body,
        userId: 1,
      }),
    );
    stop();
    return data;
  }

  @Get('cache/clear')
  @ApiOperation({ summary: 'Clear posts cache — forces a GET_MISS on the next GET /posts' })
  @ApiResponse({ status: 200, description: 'Cache cleared' })
  async clearCache(): Promise<{ cleared: boolean }> {
    await this.cache.del(POSTS_CACHE_KEY);
    this.logger?.info('Posts cache cleared');
    return { cleared: true };
  }

  @Get('todos/:id')
  @ApiOperation({
    summary: 'Fetch a todo with its assignee — demonstrates two concurrent axios calls',
  })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 200, description: 'Todo enriched with assignee info' })
  async getTodo(@Param('id') id: string): Promise<unknown> {
    const key = `${TODOS_CACHE_KEY}:${id}`;
    const cached = await this.cache.get(key);
    if (cached) {
      this.logger?.info(`Todo #${id} served from cache (HIT)`);
      return cached;
    }

    this.logger?.info(`Fetching todo #${id} and assignee in parallel (MISS)`);
    const stop = this.profiler.startSpan('http.todo');
    const [todoResponse, userResponse] = await Promise.all([
      firstValueFrom(
        this.http.get<{ userId: number; id: number; title: string; completed: boolean }>(
          `https://jsonplaceholder.typicode.com/todos/${id}`,
        ),
      ),
      firstValueFrom(this.http.get<JphUser>(`https://jsonplaceholder.typicode.com/users/${id}`)),
    ]);
    stop();

    const enriched = {
      ...todoResponse.data,
      assignee: {
        id: userResponse.data.id,
        name: userResponse.data.name,
        username: userResponse.data.username,
        email: userResponse.data.email,
      },
    };

    await this.cache.set(key, enriched, 60000);
    return enriched;
  }
}
