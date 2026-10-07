import { Injectable } from '@nestjs/common';
import { type DrizzleDb } from '../../db/drizzle.module';
import { outboxEvents } from '../../db/schema';

export interface RecordEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  correlationId?: string;
}

@Injectable()
export class OutboxService {
  /**
   * Inserts one row into `outbox_events`.
   *
   * IMPORTANT: `tx` must be the transaction-scoped `DrizzleDb` handed to the callback of
   * `db.transaction(async (tx) => { ... })` - the same `tx` the caller used to write the
   * state change this event describes. Passing the top-level `db` (injected via `DRIZZLE`)
   * instead silently breaks the whole point of the Transactional Outbox pattern: the state
   * write and this insert would no longer commit/rollback together, so an event could be
   * published for a transaction that never committed, or lost for one that did.
   * See architecture.md §4.3.
   */
  async record(tx: DrizzleDb, event: RecordEventInput): Promise<void> {
    await tx.insert(outboxEvents).values({
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      correlationId: event.correlationId ?? null,
    });
  }
}
