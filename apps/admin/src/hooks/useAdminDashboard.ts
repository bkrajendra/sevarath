import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// Phase 10.4 (docs/plan.md §5): the Dashboard page now also subscribes to `/ws` (see
// useAdminSocket.ts), which patches the live-map cache in real time and nudges a summary
// refetch on every ride-lifecycle change. Polling stays wired here too, not removed outright -
// it's the fallback if that socket is ever disconnected, same resilience posture the Flutter
// apps already use for their own sockets. The live map's interval is slowed way down now that
// the socket carries the real-time load; the summary keeps its original cadence as the
// baseline "worst case, no socket nudge ever lands" guarantee.
const SUMMARY_REFETCH_INTERVAL_MS = 10_000;
const LIVE_MAP_FALLBACK_REFETCH_INTERVAL_MS = 60_000;

const DASHBOARD_SUMMARY_KEY = ['admin', 'dashboard-summary'] as const;
const LIVE_MAP_KEY = ['admin', 'live-map'] as const;

export function useDashboardSummary() {
  return useQuery({
    queryKey: DASHBOARD_SUMMARY_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/admin/dashboard/summary');
      if (error) throw error;
      return data;
    },
    refetchInterval: SUMMARY_REFETCH_INTERVAL_MS,
  });
}

export function useLiveMap() {
  return useQuery({
    queryKey: LIVE_MAP_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/admin/live-map');
      if (error) throw error;
      return data;
    },
    refetchInterval: LIVE_MAP_FALLBACK_REFETCH_INTERVAL_MS,
  });
}
