import { Skeleton } from '@/components/ui/skeleton';

/**
 * A loading placeholder shaped like the table it's about to become, instead of a plain "Loading…"
 * line - every admin list page swaps to its real <Table> the instant data arrives, and that
 * instant swap from bare text to a full table is exactly the kind of teleporting content change
 * worth bridging (find-animation-opportunities: "preventing a jarring change"). Skeleton's own
 * `animate-pulse` is enough motion here - no extra animation needed on top.
 */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4">
          {Array.from({ length: columns }).map((_, col) => (
            <Skeleton key={col} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
