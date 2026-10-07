/** BullMQ queue that the outbox publisher pushes domain events onto, for WebSocket forwarding. */
export const DOMAIN_EVENTS_QUEUE = 'domain-events';

/**
 * BullMQ queue that the outbox publisher pushes the *same* domain-event jobs onto, for push
 * notifications (Phase 7). A BullMQ queue is a work queue, not a pub/sub topic - a second
 * `@Processor` listening on `DOMAIN_EVENTS_QUEUE` itself would only steal half the jobs away
 * from `DomainEventRealtimeConsumer` instead of getting its own copy of every event. This
 * second queue is the actual fan-out point: `OutboxPublisherService.publishOne` enqueues onto
 * both queues for every row, so each one has its own independent consumer and its own
 * independent delivery guarantees. See docs/open-items.md for the full reasoning.
 */
export const NOTIFICATION_EVENTS_QUEUE = 'notification-events';
