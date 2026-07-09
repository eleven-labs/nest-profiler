import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ReviewRepository } from '../../domain/review.repository.js';
import type { NewReview, Review, ReviewStats } from '../../domain/review.js';
import { Review as ReviewSchemaClass, type ReviewDocument } from './review.schema.js';
import { toCsvRow } from '../../../shared/csv.util.js';

/** Maps a Mongoose document (with `_id` + timestamps) to the domain model. */
function toDomain(doc: ReviewDocument): Review {
  const timestamps = doc as unknown as { createdAt: Date; updatedAt: Date };
  return {
    id: doc._id.toString(),
    productId: doc.productId,
    rating: doc.rating,
    comment: doc.comment,
    author: doc.author,
    status: doc.status,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  };
}

@Injectable()
export class MongooseReviewRepository implements ReviewRepository {
  constructor(@InjectModel(ReviewSchemaClass.name) private readonly model: Model<ReviewDocument>) {}

  async findAll(): Promise<Review[]> {
    const reviews = await this.model.find().sort({ createdAt: -1 }).exec();
    return reviews.map(toDomain);
  }

  // Exports documents through a Mongoose cursor() — the path that bypasses Query.exec and that the
  // profiler's streaming-read collector instruments. Streams the collection into CSV row by row.
  async streamCsv(): Promise<string> {
    const cursor = this.model.find().sort({ createdAt: -1 }).cursor();
    const lines: string[] = ['id,productId,rating,author'];
    for await (const doc of cursor) {
      lines.push(toCsvRow([doc._id.toString(), doc.productId, doc.rating, doc.author]));
    }
    return lines.join('\n');
  }

  async findApproved(): Promise<Review[]> {
    const reviews = await this.model.find({ status: 'approved' }).exec();
    return reviews.map(toDomain);
  }

  async findByProduct(productId: string): Promise<Review[]> {
    const reviews = await this.model.find({ productId }).sort({ rating: -1 }).exec();
    return reviews.map(toDomain);
  }

  async findById(id: string): Promise<Review | null> {
    const review = await this.model.findById(id).exec();
    return review ? toDomain(review) : null;
  }

  async create(data: NewReview): Promise<Review> {
    const review = await this.model.create({ ...data, status: data.status ?? 'pending' });
    return toDomain(review);
  }

  async delete(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }

  async clear(): Promise<void> {
    await this.model.deleteMany({}).exec();
  }

  async stats(): Promise<ReviewStats[]> {
    const result = await this.model
      .aggregate<{ _id: string; avgRating: number; count: number }>([
        { $match: { status: 'approved' } },
        { $group: { _id: '$productId', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
        { $sort: { avgRating: -1 } },
      ])
      .exec();
    return result.map((r) => ({
      productId: r._id,
      avgRating: Math.round(r.avgRating * 10) / 10,
      count: r.count,
    }));
  }
}
