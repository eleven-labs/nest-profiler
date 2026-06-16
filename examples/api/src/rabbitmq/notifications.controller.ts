import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublishNotificationDto } from './notification.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('rabbitmq')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Publish a notification to RabbitMQ (consumed back and profiled as a message)',
  })
  async publish(@Body() dto: PublishNotificationDto): Promise<{ published: boolean }> {
    await this.notifications.publish({ ...dto, publishedAt: new Date().toISOString() });
    return { published: true };
  }
}
