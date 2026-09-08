import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { TracerService } from '@eleven-labs/nest-profiler';
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
    private readonly tracer: TracerService,
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
    const reviews = await this.tracer.span('db.reviews.findAll', () => this.repo.findAll());
    this.logger.debug(`Found ${reviews.length} reviews`);
    return reviews;
  }

  async exportCsv(): Promise<string> {
    this.logger.log('Streaming all reviews to CSV');
    const csv = await this.tracer.span('db.reviews.exportCsv', () => this.repo.streamCsv());
    return csv;
  }

  async findApproved(): Promise<Review[]> {
    const reviews = await this.tracer.span('db.reviews.findApproved', () =>
      this.repo.findApproved(),
    );
    return reviews;
  }

  async findByProduct(productId: string): Promise<Review[]> {
    this.logger.log(`Fetching reviews for product ${productId}`);
    const reviews = await this.tracer.span('db.reviews.findByProduct', () =>
      this.repo.findByProduct(productId),
    );
    return reviews;
  }

  async findOne(id: string): Promise<Review> {
    this.logger.log(`Fetching review ${id}`);
    const review = await this.tracer.span('db.reviews.findOne', () => this.repo.findById(id));
    if (!review) {
      this.logger.warn(`Review ${id} not found`);
      throw new NotFoundException(`Review ${id} not found`);
    }
    return review;
  }

  async create(data: NewReview): Promise<Review> {
    this.logger.log(`Creating review for product ${data.productId}`);
    const review = await this.tracer.span('db.reviews.create', () =>
      this.repo.create({ ...data, status: data.status ?? 'pending' }),
    );
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
    await this.tracer.span('db.reviews.delete', () => this.repo.delete(id));
    this.logger.log(`Review ${id} deleted`);
  }

  async getStats(): Promise<ReviewStats[]> {
    this.logger.log('Aggregating review stats by product');
    const stats = await this.tracer.span('db.reviews.aggregate', () => this.repo.stats());
    return stats;
  }
}
