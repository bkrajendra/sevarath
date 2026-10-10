import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LiveDriverMap } from '@/components/live-driver-map';
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
      <Card className="border-foreground bg-foreground text-background">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <p className="text-sm text-background/70">Active rides right now</p>
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
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(summary?.vehiclesByStatus ?? {}).map(([key, count]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <Badge variant={vehicleStatusVariant[key as keyof typeof vehicleStatusVariant]}>
                      {key}
                    </Badge>
                    <span className="text-xl font-semibold text-foreground">{count}</span>
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
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(summary?.driversByAvailability ?? {}).map(([key, count]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <Badge variant={availabilityVariant[key as keyof typeof availabilityVariant]}>
                      {key}
                    </Badge>
                    <span className="text-xl font-semibold text-foreground">{count}</span>
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
          <p className="text-sm text-muted-foreground">Updates every 10s.</p>
        </CardHeader>
        <CardContent>
          {liveMapLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Tabs defaultValue="list">
              <TabsList>
                <TabsTrigger value="list">List View</TabsTrigger>
                <TabsTrigger value="map">Map View</TabsTrigger>
              </TabsList>
              <TabsContent value="list">
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
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No drivers currently reporting a position.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TabsContent>
              <TabsContent value="map">
                <LiveDriverMap drivers={liveMap ?? []} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
