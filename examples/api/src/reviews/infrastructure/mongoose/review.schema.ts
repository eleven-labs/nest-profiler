import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ timestamps: true, collection: 'reviews' })
export class Review {
  @Prop({ required: true })
  productId!: string;

  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ required: true })
  comment!: string;

  @Prop({ required: true })
  author!: string;

  @Prop({ default: 'pending' })
  status!: 'pending' | 'approved';
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
