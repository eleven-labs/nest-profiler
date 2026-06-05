import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { Review, type ReviewDocument } from './review.schema.js';
import type { CreateReviewDto } from './dto/create-review.dto.js';

const SEED_DATA: CreateReviewDto[] = [
  {
    productId: '1',
    rating: 5,
    comment: 'Excellent product, highly recommended!',
    author: 'Alice',
    status: 'approved',
  },
  {
    productId: '1',
    rating: 4,
    comment: 'Very good, works as expected.',
    author: 'Bob',
    status: 'approved',
  },
  {
    productId: '2',
    rating: 3,
    comment: 'Average quality, nothing special.',
    author: 'Carol',
    status: 'approved',
  },
  {
    productId: '2',
    rating: 2,
    comment: 'Disappointed, does not match the description.',
    author: 'Dave',
    status: 'pending',
  },
  {
    productId: '3',
    rating: 5,
    comment: 'Outstanding! Best purchase this year.',
    author: 'Eve',
    status: 'approved',
  },
];

@Injectable()
export class ReviewsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Review.name) private readonly model: Model<ReviewDocument>,
    private readonly profiler: ProfilerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.model.deleteMany({});
    await this.model.insertMany(SEED_DATA);
    this.logger.log(`MongoDB seeded with ${SEED_DATA.length} reviews`);
  }

  async findAll(): Promise<ReviewDocument[]> {
    this.logger.log('Fetching all reviews');
    const stop = this.profiler.startSpan('mongo.reviews.findAll');
    const reviews = await this.model.find().sort({ createdAt: -1 }).exec();
    stop();
    this.logger.debug(`Found ${reviews.length} reviews`);
    return reviews;
  }

  async findApproved(): Promise<ReviewDocument[]> {
    this.logger.log('Fetching approved reviews');
    const stop = this.profiler.startSpan('mongo.reviews.findApproved');
    const reviews = await this.model.find({ status: 'approved' }).exec();
    stop();
    return reviews;
  }

  async findByProduct(productId: string): Promise<ReviewDocument[]> {
    this.logger.log(`Fetching reviews for product ${productId}`);
    const stop = this.profiler.startSpan('mongo.reviews.findByProduct');
    const reviews = await this.model.find({ productId }).sort({ rating: -1 }).exec();
    stop();
    return reviews;
  }

  async findOne(id: string): Promise<ReviewDocument> {
    this.logger.log(`Fetching review ${id}`);
    const stop = this.profiler.startSpan('mongo.reviews.findOne');
    const review = await this.model.findById(id).exec();
    stop();
    if (!review) {
      this.logger.warn(`Review ${id} not found`);
      throw new NotFoundException(`Review ${id} not found`);
    }
    return review;
  }

  async create(dto: CreateReviewDto): Promise<ReviewDocument> {
    this.logger.log(`Creating review for product ${dto.productId}`);
    const stop = this.profiler.startSpan('mongo.reviews.create');
    const review = await this.model.create({ ...dto, status: dto.status ?? 'pending' });
    stop();
    this.logger.log(`Review ${review._id.toString()} created`);
    return review;
  }

  async remove(id: string): Promise<void> {
    this.logger.log(`Deleting review ${id}`);
    const review = await this.findOne(id);
    const stop = this.profiler.startSpan('mongo.reviews.delete');
    await review.deleteOne();
    stop();
    this.logger.log(`Review ${id} deleted`);
  }

  async getStats(): Promise<Array<{ productId: string; avgRating: number; count: number }>> {
    this.logger.log('Aggregating review stats by product');
    const stop = this.profiler.startSpan('mongo.reviews.aggregate');
    const result = await this.model
      .aggregate<{
        _id: string;
        avgRating: number;
        count: number;
      }>([
        { $match: { status: 'approved' } },
        { $group: { _id: '$productId', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
        { $sort: { avgRating: -1 } },
      ])
      .exec();
    stop();
    return result.map((r) => ({
      productId: r._id,
      avgRating: Math.round(r.avgRating * 10) / 10,
      count: r.count,
    }));
  }
}
