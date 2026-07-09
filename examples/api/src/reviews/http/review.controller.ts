import { Body, Controller, Delete, Get, Header, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReviewService } from '../application/review.service.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import type { Review, ReviewStats } from '../domain/review.js';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  @ApiOperation({ summary: 'List all reviews — demonstrates Mongoose collector' })
  @ApiResponse({ status: 200, description: 'Array of reviews' })
  findAll(): Promise<Review[]> {
    return this.reviews.findAll();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Aggregate average rating per product — demonstrates Mongoose aggregate collector',
  })
  @ApiResponse({ status: 200, description: 'Per-product rating statistics' })
  getStats(): Promise<ReviewStats[]> {
    return this.reviews.getStats();
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="reviews.csv"')
  @ApiOperation({
    summary: 'Export all reviews as CSV — streams the documents (cursor()) into the file',
  })
  @ApiResponse({ status: 200, description: 'CSV export of every review' })
  exportCsv(): Promise<string> {
    return this.reviews.exportCsv();
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get reviews for a specific product' })
  @ApiParam({ name: 'productId', example: '1' })
  @ApiResponse({ status: 200, description: 'Reviews for the product' })
  findByProduct(@Param('productId') productId: string): Promise<Review[]> {
    return this.reviews.findByProduct(productId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a review by ID' })
  @ApiParam({ name: 'id', example: '64a1b2c3d4e5f6789abcdef0' })
  @ApiResponse({ status: 200, description: 'Review found' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  findOne(@Param('id') id: string): Promise<Review> {
    return this.reviews.findOne(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a review — triggers Mongoose INSERT + validator + review.created event',
  })
  @ApiResponse({ status: 201, description: 'Review created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed — check the Validator panel in /_profiler',
  })
  create(@Body() dto: CreateReviewDto): Promise<Review> {
    return this.reviews.create(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a review by ID' })
  @ApiParam({ name: 'id', example: '64a1b2c3d4e5f6789abcdef0' })
  @ApiResponse({ status: 200, description: 'Review deleted' })
  async remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    await this.reviews.remove(id);
    return { deleted: true };
  }
}
