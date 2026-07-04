import { registerAs } from '@nestjs/config';

export default registerAs('rabbitmq', () => ({
  uri: process.env['RABBITMQ_URI'] ?? 'amqp://profiler:profiler@localhost:5672',
}));
