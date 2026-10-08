import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatRelativeTime } from '@/lib/format';
import { useDashboardSummary, useLiveMap } from '@/hooks/useAdminDashboard';

const vehicleStatusVariant = {
  AVAILABLE: 'success',
  IN_SERVICE: 'default',
  MAINTENANCE: 'warning',
  INACTIVE: 'destructive',
} as const;

const availabilityVariant = {
  AVAILABLE: 'success',
  BUSY: 'warning',
  ON_BREAK: 'warning',
  OFFLINE: 'default',
} as const;

export function DashboardPage() {
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useDashboardSummary();
  const { data: liveMap, isLoading: liveMapLoading, error: liveMapError } = useLiveMap();

  if (summaryError) throw summaryError;
  if (liveMapError) throw liveMapError;

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-slate-900 bg-slate-900 text-white">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <p className="text-sm text-slate-300">Active rides right now</p>
            <p className="text-4xl font-semibold">
              {summaryLoading ? '…' : summary?.activeRidesCount ?? 0}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vehicles by status</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(summary?.vehiclesByStatus ?? {}).map(([key, count]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <Badge variant={vehicleStatusVariant[key as keyof typeof vehicleStatusVariant]}>
                      {key}
                    </Badge>
                    <span className="text-xl font-semibold text-slate-900">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drivers by availability</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(summary?.driversByAvailability ?? {}).map(([key, count]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <Badge variant={availabilityVariant[key as keyof typeof availabilityVariant]}>
                      {key}
                    </Badge>
                    <span className="text-xl font-semibold text-slate-900">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live driver positions</CardTitle>
          {/* See docs/open-items.md (map-vs-table decision) and #38 - no map library/tile
              server exists in this app yet, so this is raw position data, not a map. */}
          <p className="text-sm text-slate-500">
            Map view not available yet - showing raw position data. Updates every 10s.
          </p>
        </CardHeader>
        <CardContent>
          {liveMapLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Latitude</TableHead>
                  <TableHead>Longitude</TableHead>
                  <TableHead>Last update</TableHead>
                  <TableHead>Current ride</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {liveMap?.map((driver) => (
                  <TableRow key={driver.driverId}>
                    <TableCell className="font-medium">{driver.driverCode}</TableCell>
                    <TableCell>
                      <Badge variant={availabilityVariant[driver.availability]}>{driver.availability}</Badge>
                    </TableCell>
                    <TableCell>{driver.latitude.toFixed(5)}</TableCell>
                    <TableCell>{driver.longitude.toFixed(5)}</TableCell>
                    <TableCell>{formatRelativeTime(driver.locationUpdatedAt)}</TableCell>
                    <TableCell>
                      {driver.activeRideId
                        ? `${driver.activeRideStatus} (${driver.activeRideId.slice(0, 8)}…)`
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
                {liveMap?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-slate-500">
                      No drivers currently reporting a position.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
