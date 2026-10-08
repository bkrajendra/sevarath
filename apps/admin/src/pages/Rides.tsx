import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useAdminRides, type RideStatus } from '@/hooks/useAdminRides';

const PAGE_SIZE = 20;

// Hand-maintained against RideResponseDto['status'] (see useAdminRides.ts) - TS string
// literal unions have no runtime reflection, so this list can't be generated from the
// type automatically. Typed as RideStatus[] below so a renamed/removed status fails the
// build; a newly *added* status won't auto-appear here and needs a manual addition
// (documented in docs/open-items.md).
const RIDE_STATUSES: RideStatus[] = [
  'REQUESTED',
  'SEARCHING_DRIVER',
  'DRIVER_ASSIGNED',
  'DRIVER_EN_ROUTE_TO_PICKUP',
  'DRIVER_ARRIVED',
  'RIDE_STARTED',
  'DRIVER_EN_ROUTE_TO_DESTINATION',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_SYSTEM',
  'NO_DRIVER_AVAILABLE',
];

const statusVariant: Record<RideStatus, 'default' | 'success' | 'warning' | 'destructive'> = {
  REQUESTED: 'default',
  SEARCHING_DRIVER: 'warning',
  DRIVER_ASSIGNED: 'warning',
  DRIVER_EN_ROUTE_TO_PICKUP: 'warning',
  DRIVER_ARRIVED: 'warning',
  RIDE_STARTED: 'success',
  DRIVER_EN_ROUTE_TO_DESTINATION: 'success',
  COMPLETED: 'success',
  CANCELLED_BY_USER: 'destructive',
  CANCELLED_BY_DRIVER: 'destructive',
  CANCELLED_BY_SYSTEM: 'destructive',
  NO_DRIVER_AVAILABLE: 'destructive',
};

function locationLabel(name: string | null, lat: number, lng: number): string {
  return name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function RidesPage() {
  const [status, setStatus] = useState<RideStatus | ''>('');
  const [requestedAfter, setRequestedAfter] = useState('');
  const [requestedBefore, setRequestedBefore] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error } = useAdminRides({
    status: status || undefined,
    requestedAfter: requestedAfter ? new Date(requestedAfter).toISOString() : undefined,
    requestedBefore: requestedBefore ? new Date(requestedBefore).toISOString() : undefined,
    limit: PAGE_SIZE,
    offset,
  });

  if (error) throw error;

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Rides</CardTitle>
          <p className="text-sm text-slate-500">Campus-wide ride search, not limited to one user.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Status</label>
              <select
                className={cn(
                  'h-9 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
                )}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as RideStatus | '');
                  setOffset(0);
                }}
              >
                <option value="">All statuses</option>
                {RIDE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Requested after</label>
              <Input
                type="datetime-local"
                value={requestedAfter}
                onChange={(e) => {
                  setRequestedAfter(e.target.value);
                  setOffset(0);
                }}
                className="w-56"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Requested before</label>
              <Input
                type="datetime-local"
                value={requestedBefore}
                onChange={(e) => {
                  setRequestedBefore(e.target.value);
                  setOffset(0);
                }}
                className="w-56"
              />
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-500">Loading rides…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ride ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pickup</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Requested at</TableHead>
                  <TableHead>Driver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((ride) => (
                  <TableRow key={ride.id}>
                    <TableCell className="font-mono text-xs">{ride.id}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[ride.status]}>{ride.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {locationLabel(ride.pickupLocationName, ride.pickupLatitude, ride.pickupLongitude)}
                    </TableCell>
                    <TableCell>
                      {locationLabel(
                        ride.destinationLocationName,
                        ride.destinationLatitude,
                        ride.destinationLongitude,
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(ride.requestedAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{ride.driverId ?? '-'}</TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      No rides match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {total === 0 ? 'No results' : `${rangeStart}-${rangeEnd} of ${total}`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
