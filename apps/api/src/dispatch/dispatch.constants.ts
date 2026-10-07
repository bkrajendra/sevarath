/** BullMQ queue that delayed per-offer timeout jobs are enqueued onto. */
export const RIDE_OFFER_TIMEOUT_QUEUE = 'ride-offer-timeouts';

/** Job name used for every delayed timeout job on RIDE_OFFER_TIMEOUT_QUEUE. */
export const RIDE_OFFER_TIMEOUT_JOB = 'ride-offer-timeout';

/**
 * Bounded driver response window - specification.md §3.2: "Receive ride requests with a bounded
 * response window (default 15s)". Named here rather than hardcoded at each call site.
 */
export const OFFER_RESPONSE_WINDOW_MS = 15_000;
