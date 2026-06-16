import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreatePostDto } from './dto/create-post.dto.js';
import { PostsService } from './posts.service.js';
import { PostsFetchService } from './posts-fetch.service.js';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly postsFetch: PostsFetchService,
  ) {}

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
  getPosts(): Promise<unknown[]> {
    return this.posts.getEnrichedPosts();
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
    return this.posts.createPost(dto);
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
  forwardPost(@Body() dto: CreatePostDto): Promise<unknown> {
    return this.posts.forwardPost(dto);
  }

  @Get('via-fetch')
  @ApiOperation({
    summary:
      'Fetch a post with the native fetch API (no axios) — recorded via HttpProfilerRecorder, shown in the same HTTP Client panel',
    description:
      'Demonstrates the client-agnostic API: a plain `fetch` call is timed and pushed to the ' +
      'profiler with `recorder.capture(...)`, so it appears in the HTTP Client panel alongside axios calls.',
  })
  @ApiResponse({
    status: 200,
    description: 'Post fetched via native fetch — see the HTTP Client panel in /_profiler',
  })
  getViaFetch(): Promise<unknown> {
    return this.postsFetch.fetchFirstPost();
  }

  @Get('cache/clear')
  @ApiOperation({ summary: 'Clear posts cache — forces a GET_MISS on the next GET /posts' })
  @ApiResponse({ status: 200, description: 'Cache cleared' })
  clearCache(): Promise<{ cleared: boolean }> {
    return this.posts.clearCache();
  }

  @Get('todos/:id')
  @ApiOperation({
    summary: 'Fetch a todo with its assignee — demonstrates two concurrent axios calls',
  })
  @ApiParam({ name: 'id', example: '1' })
  @ApiResponse({ status: 200, description: 'Todo enriched with assignee info' })
  getTodo(@Param('id') id: string): Promise<unknown> {
    return this.posts.getTodo(id);
  }
}
