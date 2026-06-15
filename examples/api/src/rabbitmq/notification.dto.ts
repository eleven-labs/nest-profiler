import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Body of `POST /notifications` — published to RabbitMQ and consumed back. */
export class PublishNotificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;
}
