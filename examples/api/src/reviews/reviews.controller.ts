import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import type { ReviewDocument } from './review.schema.js';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'List all reviews — demonstrates Mongoose collector' })
  @ApiResponse({ status: 200, description: 'Array of reviews' })
  findAll(): Promise<ReviewDocument[]> {
    return this.reviews.findAll();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Aggregate average rating per product — demonstrates Mongoose aggregate collector',
  })
  @ApiResponse({ status: 200, description: 'Per-product rating statistics' })
  getStats(): Promise<Array<{ productId: string; avgRating: number; count: number }>> {
    return this.reviews.getStats();
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get reviews for a specific product' })
  @ApiParam({ name: 'productId', example: '64a1b2c3d4e5f6789abcdef0' })
  @ApiResponse({ status: 200, description: 'Reviews for the product' })
  findByProduct(@Param('productId') productId: string): Promise<ReviewDocument[]> {
    return this.reviews.findByProduct(productId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a review by ID' })
  @ApiParam({ name: 'id', example: '64a1b2c3d4e5f6789abcdef0' })
  @ApiResponse({ status: 200, description: 'Review found' })
  @ApiResponse({ status: 404, description: 'Review not found' })
  findOne(@Param('id') id: string): Promise<ReviewDocument> {
    return this.reviews.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a review — triggers Mongoose INSERT + validator collector' })
  @ApiResponse({ status: 201, description: 'Review created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed — check the Validator panel in /_profiler',
  })
  create(@Body() dto: CreateReviewDto): Promise<ReviewDocument> {
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
