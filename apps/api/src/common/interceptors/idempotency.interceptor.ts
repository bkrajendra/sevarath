import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { idempotencyKeys, type IdempotencyKeyRow } from '../../db/schema';

type ClaimResult =
  | { outcome: 'claimed'; id: string }
  | { outcome: 'completed'; responseBody: unknown }
  | { outcome: 'in_progress' };

/**
 * specification.md §11.1 / architecture.md §6.2: opt-in `Idempotency-Key` support for the five
 * mutating ride/dispatch commands (create/accept/cancel/start/complete ride).
 *
 * `route` identifies which *endpoint* a key was used on, so the same key value used by the same
 * user on two different routes (pure coincidence) never collides. We build it as
 * `${ControllerClass}#${handlerMethod}` (e.g. "RidesController#cancel") rather than
 * `request.route.path`: both identify the route pattern (not a literal URL with an id baked in)
 * equally well, but the class#method form needs no assumption about how/when Express populates
 * `request.route` relative to when this interceptor runs - it is only ever undefined when it's
 * unavailable, never silently wrong - and it doesn't depend on Nest's global prefix/versioning
 * trimming. See docs/open-items.md for this call.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKeyHeader = request.headers?.['idempotency-key'];

    // Idempotency is opt-in per the client - an endpoint in scope must work fine for a caller
    // that never sends the header.
    if (!idempotencyKeyHeader || typeof idempotencyKeyHeader !== 'string') {
      return next.handle();
    }

    // Guards (JwtAuthGuard) run before interceptors in Nest's pipeline, so request.user is
    // already populated here.
    const userId: string = request.user?.userId;
    const route = `${context.getClass().name}#${context.getHandler().name}`;

    return from(this.claim(userId, route, idempotencyKeyHeader)).pipe(
      mergeMap((claimResult) => {
        if (claimResult.outcome === 'completed') {
          // Return the stored body through Nest's normal response pipeline (serialization,
          // status code from this route's own @HttpCode/default decorator, etc). We deliberately
          // do NOT write to the Express response object ourselves (no response.status().json()),
          // which would race Nest's own response-writing and risk "headers already sent". We also
          // don't replay the original HTTP status code: each of these five endpoints has exactly
          // one fixed success status regardless of whether this is a fresh call or a replay, so
          // letting Nest apply its normal per-route status is already correct - please don't "fix"
          // this by adding status-code persistence/replay.
          return of(claimResult.responseBody);
        }

        if (claimResult.outcome === 'in_progress') {
          // A genuinely concurrent duplicate request for the same key, still being processed.
          return throwError(
            () => new ConflictException({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS' }),
          );
        }

        const rowId = claimResult.id;
        return next.handle().pipe(
          mergeMap((responseBody) =>
            from(this.persistCompleted(rowId, responseBody)).pipe(map(() => responseBody)),
          ),
          catchError((error) =>
            // A failed attempt must never be "successfully" cached - delete the claim so a
            // retry with the same key gets a genuinely fresh attempt, then re-throw so normal
            // exception handling still applies.
            from(this.deleteRow(rowId)).pipe(mergeMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }

  /**
   * Atomically claims (userId, route, idempotencyKey) via the table's unique index: the insert
   * either succeeds (we won the claim and should run the real handler) or conflicts (someone else
   * already claimed it, or already finished it - look their row up instead of racing a second
   * write).
   */
  private async claim(userId: string, route: string, idempotencyKey: string): Promise<ClaimResult> {
    const [inserted] = await this.db
      .insert(idempotencyKeys)
      .values({ userId, route, idempotencyKey, status: 'IN_PROGRESS' })
      .onConflictDoNothing({
        target: [idempotencyKeys.userId, idempotencyKeys.route, idempotencyKeys.idempotencyKey],
      })
      .returning();

    if (inserted) {
      return { outcome: 'claimed', id: inserted.id };
    }

    const existing = await this.findExisting(userId, route, idempotencyKey);

    if (!existing) {
      // Extremely unlikely race: the other claimant's attempt errored and deleted its row in the
      // window between our failed insert and this lookup. Retry the claim once - from its point
      // of view the key is now free again.
      return this.claim(userId, route, idempotencyKey);
    }

    if (existing.status === 'COMPLETED') {
      return { outcome: 'completed', responseBody: existing.responseBody };
    }

    return { outcome: 'in_progress' };
  }

  private findExisting(
    userId: string,
    route: string,
    idempotencyKey: string,
  ): Promise<IdempotencyKeyRow | undefined> {
    return this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.route, route),
          eq(idempotencyKeys.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1)
      .then(([row]) => row);
  }

  private async persistCompleted(id: string, responseBody: unknown): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({
        status: 'COMPLETED',
        responseBody: (responseBody ?? null) as IdempotencyKeyRow['responseBody'],
        completedAt: new Date(),
      })
      .where(eq(idempotencyKeys.id, id));
  }

  private async deleteRow(id: string): Promise<void> {
    await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
  }
}
