import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

// Polling, not a WebSocket subscription: a full real-time wire-up (subscribing to
// `/ws` for dashboard/live-map updates, per docs/open-items.md #38's own forward
// pointer) is explicitly out of scope for this pass. A 10s refetch interval keeps
// the dashboard reasonably "live" without that extra plumbing - see
// docs/open-items.md for the fuller tradeoff note.
const REFETCH_INTERVAL_MS = 10_000;

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
    refetchInterval: REFETCH_INTERVAL_MS,
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
    refetchInterval: REFETCH_INTERVAL_MS,
  });
}
