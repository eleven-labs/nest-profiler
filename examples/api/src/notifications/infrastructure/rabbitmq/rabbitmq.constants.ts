/**
 * Exchange and routing key the demo publishes to and subscribes from. The routing key matches the
 * `review.created` domain event name emitted by the reviews context (kept as a literal here so the
 * notifications context stays decoupled from the emitting context).
 */
export const NOTIFICATIONS_EXCHANGE = 'profiler.demo';
export const REVIEW_CREATED_ROUTING_KEY = 'review.created';
export const NOTIFICATIONS_QUEUE = 'profiler.demo.notifications';

/**
 * Dead-letter exchange and queue the notifications queue routes rejected messages to. Nothing
 * consumes the dead-letter queue — it is there to show the **Discover / RabbitMQ** view listing the
 * topology an application declares, not only the queues it subscribes to.
 */
export const NOTIFICATIONS_DEAD_LETTER_EXCHANGE = 'profiler.demo.dlx';
export const NOTIFICATIONS_DEAD_LETTER_QUEUE = 'profiler.demo.notifications.dlq';
