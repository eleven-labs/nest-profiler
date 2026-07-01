/**
 * Exchange and routing key the demo publishes to and subscribes from. The routing key matches the
 * `review.created` domain event name emitted by the reviews context (kept as a literal here so the
 * notifications context stays decoupled from the emitting context).
 */
export const NOTIFICATIONS_EXCHANGE = 'profiler.demo';
export const REVIEW_CREATED_ROUTING_KEY = 'review.created';
export const NOTIFICATIONS_QUEUE = 'profiler.demo.notifications';
