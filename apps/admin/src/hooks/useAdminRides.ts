import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { components } from '@/types/api';

export type RideStatus = components['schemas']['RideResponseDto']['status'];

export interface AdminRidesQuery {
  status?: RideStatus;
  userId?: string;
  driverId?: string;
  requestedAfter?: string;
  requestedBefore?: string;
  limit: number;
  offset: number;
}

const ADMIN_RIDES_KEY = (query: AdminRidesQuery) => ['admin', 'rides', query] as const;

export function useAdminRides(query: AdminRidesQuery) {
  return useQuery({
    queryKey: ADMIN_RIDES_KEY(query),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/admin/rides', {
        params: {
          query: {
            status: query.status,
            userId: query.userId || undefined,
            driverId: query.driverId || undefined,
            requestedAfter: query.requestedAfter || undefined,
            requestedBefore: query.requestedBefore || undefined,
            limit: query.limit,
            offset: query.offset,
          },
        },
      });
      if (error) throw error;
      return data;
    },
  });
}
