import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArticleService } from '../application/article.service.js';
import { CreateArticleDto } from './dto/create-article.dto.js';
import type { Article, ForwardedArticle, TodoWithAssignee } from '../domain/article.js';

@ApiTags('content')
@Controller('articles')
export class ArticleController {
  constructor(private readonly articles: ArticleService) {}

  @Get()
  @ApiOperation({
    summary:
      'Fetch articles enriched with author info — demonstrates multiple concurrent HTTP calls + cache',
    description:
      'First call: GET_MISS → fetches articles then resolves each author in parallel (N+1 HTTP calls) → SET. ' +
      'Subsequent calls: GET_HIT, no outgoing call.',
  })
  @ApiResponse({
    status: 200,
    description: 'Enriched articles — HTTP Client panel shows all outgoing calls on first request',
  })
  getArticles(): Promise<Article[]> {
    return this.articles.getEnrichedArticles();
  }

  @Post()
  @ApiOperation({
    summary: 'Create an article — demonstrates validator collector (valid & invalid DTOs)',
  })
  @ApiResponse({ status: 201, description: 'Article created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed — check the Validator panel in /_profiler',
  })
  createArticle(@Body() dto: CreateArticleDto): Record<string, unknown> {
    return this.articles.createArticle(dto);
  }

  @Post('forward')
  @ApiOperation({
    summary:
      'Forward an article to the external API via a POST — shows request/response bodies in the HTTP Client panel',
  })
  @ApiResponse({
    status: 201,
    description: 'Article forwarded — check the HTTP Client panel in /_profiler',
  })
  forwardArticle(@Body() dto: CreateArticleDto): Promise<ForwardedArticle> {
    return this.articles.forwardArticle(dto);
  }

  @Get('cache/clear')
  @ApiOperation({ summary: 'Clear articles cache — forces a GET_MISS on the next GET /articles' })
  @ApiResponse({ status: 200, description: 'Cache cleared' })
  clearCache(): Promise<{ cleared: boolean }> {
    return this.articles.clearCache();
  }

  @Get('todos/:id')
  @ApiOperation({
    summary: 'Fetch a todo with its assignee — demonstrates two concurrent HTTP calls',
  })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, description: 'Todo enriched with assignee info' })
  getTodo(@Param('id', ParseIntPipe) id: number): Promise<TodoWithAssignee> {
    return this.articles.getTodo(id);
  }
}
