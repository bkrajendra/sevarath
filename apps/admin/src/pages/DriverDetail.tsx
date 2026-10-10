import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import {
  useApproveDriver,
  useAssignVehicle,
  useDriver,
  useSuspendDriver,
  useUpdateDriver,
} from '@/hooks/useDrivers';
import { useVehicles } from '@/hooks/useVehicles';
import { isForbidden, useUser } from '@/hooks/useUsers';

const statusVariant = {
  PENDING: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'destructive',
  INACTIVE: 'default',
} as const;

export function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: driver, isLoading, error } = useDriver(id);
  const { data: user, error: userError } = useUser(driver?.userId);
  const { data: vehicles } = useVehicles();
  const approveDriver = useApproveDriver();
  const suspendDriver = useSuspendDriver();
  const assignVehicle = useAssignVehicle();
  const updateDriver = useUpdateDriver();

  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [driverCode, setDriverCode] = useState('');

  useEffect(() => {
    if (driver) setDriverCode(driver.driverCode);
  }, [driver]);

  if (error) throw error;

  if (isLoading || !driver) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const vehicleCodeById = new Map(vehicles?.map((v) => [v.id, v.vehicleCode]));
  const userLinkForbidden = isForbidden(userError);

  function handleSaveDriverCode(e: React.FormEvent) {
    e.preventDefault();
    if (!driver || !driverCode || driverCode === driver.driverCode) return;
    updateDriver.mutate({ id: driver.id, driverCode });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/drivers')}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-lg font-semibold">Driver {driver.driverCode}</h1>
        <Badge variant={statusVariant[driver.status]}>{driver.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linked user</CardTitle>
        </CardHeader>
        <CardContent>
          {userLinkForbidden ? (
            <p className="text-sm text-muted-foreground">Linked user details require admin access.</p>
          ) : user ? (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd className="text-sm font-medium">{user.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Mobile</dt>
                <dd className="text-sm font-medium">{user.mobile}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="text-sm font-medium">{user.email ?? '-'}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status &amp; availability</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Availability</dt>
              <dd className="text-sm font-medium">{driver.availability}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Assigned vehicle</dt>
              <dd className="text-sm font-medium">
                {driver.currentVehicleId
                  ? (vehicleCodeById.get(driver.currentVehicleId) ?? driver.currentVehicleId)
                  : 'None'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last known position</dt>
              <dd className="text-sm font-medium">{formatRelativeTime(driver.locationUpdatedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="text-sm font-medium">{formatDateTime(driver.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last updated</dt>
              <dd className="text-sm font-medium">{formatDateTime(driver.updatedAt)}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {driver.status === 'PENDING' && (
              <Button size="sm" onClick={() => approveDriver.mutate(driver.id)}>
                Approve
              </Button>
            )}
            {driver.status === 'ACTIVE' && (
              <Button size="sm" variant="destructive" onClick={() => suspendDriver.mutate(driver.id)}>
                Suspend
              </Button>
            )}
            {driver.status === 'SUSPENDED' && (
              <Button size="sm" onClick={() => approveDriver.mutate(driver.id)}>
                Reactivate
              </Button>
            )}
            <select
              className={cn(
                'h-8 rounded-md border border-input bg-background px-2 text-xs',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              value={selectedVehicle}
              onChange={(e) => setSelectedVehicle(e.target.value)}
            >
              <option value="">Select vehicle…</option>
              {vehicles?.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.vehicleCode}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedVehicle || assignVehicle.isPending}
              onClick={() => assignVehicle.mutate({ id: driver.id, vehicleId: selectedVehicle })}
            >
              Assign vehicle
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Edit driver code</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveDriverCode} className="flex flex-wrap items-end gap-3">
            <div className="flex w-full flex-col gap-1 sm:w-auto">
              <Label htmlFor="driverCode" className="text-xs font-medium text-muted-foreground">
                Driver code
              </Label>
              <Input
                id="driverCode"
                value={driverCode}
                onChange={(e) => setDriverCode(e.target.value)}
                className="w-full sm:w-40"
              />
            </div>
            <Button type="submit" disabled={updateDriver.isPending || driverCode === driver.driverCode}>
              Save
            </Button>
          </form>
          {updateDriver.isError && (
            <p className="mt-2 text-sm text-destructive">
              Could not save - that driver code may already be in use.
            </p>
          )}
        </CardContent>
      </Card>

      <Link to="/drivers" className="text-sm text-muted-foreground hover:underline">
        ← Back to all drivers
      </Link>
    </div>
  );
}
