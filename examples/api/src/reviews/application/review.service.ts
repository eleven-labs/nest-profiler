import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { EventPublisher } from '../../notifications/domain/event-publisher.js';
import { ReviewRepository } from '../domain/review.repository.js';
import type { NewReview, Review, ReviewStats } from '../domain/review.js';
import { REVIEW_SEED } from './review.seed.js';

/**
 * Application service for the reviews context. Depends only on the {@link ReviewRepository} port and
 * the {@link EventPublisher} port — never on Mongoose. Profiler spans live here so they describe
 * behaviour (`db.reviews.*`). Creating a review publishes a `review.created` domain event, which the
 * notifications context turns into a message (RabbitMQ when enabled, no-op otherwise).
 */
@Injectable()
export class ReviewService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly repo: ReviewRepository,
    private readonly profiler: ProfilerService,
    private readonly events: EventPublisher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.repo.clear();
    for (const seed of REVIEW_SEED) {
      await this.repo.create(seed);
    }
    this.logger.log(`MongoDB seeded with ${REVIEW_SEED.length} reviews`);
  }

  async findAll(): Promise<Review[]> {
    this.logger.log('Fetching all reviews');
    const stop = this.profiler.startSpan('db.reviews.findAll');
    const reviews = await this.repo.findAll();
    stop();
    this.logger.debug(`Found ${reviews.length} reviews`);
    return reviews;
  }

  async exportCsv(): Promise<string> {
    this.logger.log('Streaming all reviews to CSV');
    const stop = this.profiler.startSpan('db.reviews.exportCsv');
    const csv = await this.repo.streamCsv();
    stop();
    return csv;
  }

  async findApproved(): Promise<Review[]> {
    const stop = this.profiler.startSpan('db.reviews.findApproved');
    const reviews = await this.repo.findApproved();
    stop();
    return reviews;
  }

  async findByProduct(productId: string): Promise<Review[]> {
    this.logger.log(`Fetching reviews for product ${productId}`);
    const stop = this.profiler.startSpan('db.reviews.findByProduct');
    const reviews = await this.repo.findByProduct(productId);
    stop();
    return reviews;
  }

  /** Batched lookup for the DataLoader — one query for many products, grouped back by productId. */
  async findByProducts(productIds: string[]): Promise<Map<string, Review[]>> {
    this.logger.log(`Batch-fetching reviews for ${productIds.length} products`);
    const stop = this.profiler.startSpan('db.reviews.findByProducts');
    const reviews = await this.repo.findByProductIds(productIds);
    stop();
    const grouped = new Map<string, Review[]>();
    for (const review of reviews) {
      const list = grouped.get(review.productId) ?? [];
      list.push(review);
      grouped.set(review.productId, list);
    }
    return grouped;
  }

  async findOne(id: string): Promise<Review> {
    this.logger.log(`Fetching review ${id}`);
    const stop = this.profiler.startSpan('db.reviews.findOne');
    const review = await this.repo.findById(id);
    stop();
    if (!review) {
      this.logger.warn(`Review ${id} not found`);
      throw new NotFoundException(`Review ${id} not found`);
    }
    return review;
  }

  async create(data: NewReview): Promise<Review> {
    this.logger.log(`Creating review for product ${data.productId}`);
    const stop = this.profiler.startSpan('db.reviews.create');
    const review = await this.repo.create({ ...data, status: data.status ?? 'pending' });
    stop();
    await this.events.publish({
      name: 'review.created',
      payload: { reviewId: review.id, productId: review.productId, rating: review.rating },
    });
    this.logger.log(`Review ${review.id} created`);
    return review;
  }

  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting review ${id}`);
    await this.findOne(id);
    const stop = this.profiler.startSpan('db.reviews.delete');
    await this.repo.delete(id);
    stop();
    this.logger.log(`Review ${id} deleted`);
  }

  async getStats(): Promise<ReviewStats[]> {
    this.logger.log('Aggregating review stats by product');
    const stop = this.profiler.startSpan('db.reviews.aggregate');
    const stats = await this.repo.stats();
    stop();
    return stats;
  }
}
