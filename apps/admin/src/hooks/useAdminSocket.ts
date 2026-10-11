import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '@/lib/api-client';

/**
 * Admin-room `/ws` subscription (docs/plan.md §5/10.4) - replaces polling on the Dashboard page
 * specifically. Matches `location.gateway.ts`'s handshake contract exactly: a bare `/ws`
 * (namespace on the current origin, same posture `api-client.ts`'s empty `BASE_URL` already
 * assumes for a same-origin deployment) and `auth: { token }`, the same convention
 * `ride_socket_service.dart` already uses on the mobile side.
 *
 * Deliberately NOT a replacement for `useAdminDashboard.ts`'s polling - that stays as the
 * fallback if this socket is ever disconnected (same resilience posture the Flutter apps already
 * use for their own sockets), and for the summary query specifically, polling stays the primary
 * source of truth (patched live only on a `AdminDashboardChanged` nudge, not patched field-by-
 * field like the live map is).
 */

const DASHBOARD_SUMMARY_KEY = ['admin', 'dashboard-summary'] as const;
const LIVE_MAP_KEY = ['admin', 'live-map'] as const;

interface DriverLocationUpdatedPayload {
  driverId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
}

interface LiveMapRow {
  driverId: string;
  latitude: number;
  longitude: number;
  locationUpdatedAt: string | null;
  [key: string]: unknown;
}

export function useAdminSocket(enabled: boolean): void {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const token = getAccessToken();
    if (!token) return;

    const socket = io('/ws', {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('DriverLocationUpdated', (payload: DriverLocationUpdatedPayload) => {
      const existing = queryClient.getQueryData<LiveMapRow[]>(LIVE_MAP_KEY);
      if (!existing) return;

      const index = existing.findIndex((row) => row.driverId === payload.driverId);
      if (index === -1) {
        // A driver with no prior row (e.g. just came online) - cheaper to refetch once than to
        // reconstruct a full LiveMapDriverResponseDto row (driverCode/availability/activeRide*)
        // from this lightweight location-only payload.
        queryClient.invalidateQueries({ queryKey: LIVE_MAP_KEY });
        return;
      }

      const next = [...existing];
      next[index] = {
        ...next[index],
        latitude: payload.latitude,
        longitude: payload.longitude,
        locationUpdatedAt: payload.recordedAt,
      };
      queryClient.setQueryData(LIVE_MAP_KEY, next);
    });

    // Lightweight nudge only (no payload field is relied on) - re-fetch the summary sooner than
    // the next poll tick rather than trying to patch individual counters client-side.
    socket.on('AdminDashboardChanged', () => {
      queryClient.invalidateQueries({ queryKey: DASHBOARD_SUMMARY_KEY });
    });

    // On (re)connect, the live map may have drifted while disconnected - one fresh REST fetch
    // resyncs it, same "resync on reconnect" posture the gateway's own RideSync push embodies
    // for ride state.
    socket.on('connect', () => {
      queryClient.invalidateQueries({ queryKey: LIVE_MAP_KEY });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, queryClient]);
}
