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
import { formatDateTime } from '@/lib/format';
import { useUpdateVehicle, useUpdateVehicleStatus, useVehicle } from '@/hooks/useVehicles';

const statusVariant = {
  AVAILABLE: 'success',
  IN_SERVICE: 'default',
  MAINTENANCE: 'warning',
  INACTIVE: 'destructive',
} as const;

const STATUSES = ['AVAILABLE', 'IN_SERVICE', 'MAINTENANCE', 'INACTIVE'] as const;

export function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: vehicle, isLoading, error } = useVehicle(id);
  const updateVehicle = useUpdateVehicle();
  const updateStatus = useUpdateVehicleStatus();

  const [form, setForm] = useState({ vehicleCode: '', registrationNumber: '', vehicleType: '', capacity: '' });

  useEffect(() => {
    if (vehicle) {
      setForm({
        vehicleCode: vehicle.vehicleCode,
        registrationNumber: vehicle.registrationNumber ?? '',
        vehicleType: vehicle.vehicleType,
        capacity: String(vehicle.capacity),
      });
    }
  }, [vehicle]);

  if (error) throw error;

  if (isLoading || !vehicle) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const isDirty =
    form.vehicleCode !== vehicle.vehicleCode ||
    form.registrationNumber !== (vehicle.registrationNumber ?? '') ||
    form.vehicleType !== vehicle.vehicleType ||
    form.capacity !== String(vehicle.capacity);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicle || !isDirty || !form.vehicleCode) return;
    updateVehicle.mutate({
      id: vehicle.id,
      vehicleCode: form.vehicleCode,
      registrationNumber: form.registrationNumber || undefined,
      vehicleType: form.vehicleType || undefined,
      capacity: Number(form.capacity) || undefined,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate('/vehicles')}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-lg font-semibold">Vehicle {vehicle.vehicleCode}</h1>
        <Badge variant={statusVariant[vehicle.status]}>{vehicle.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="text-sm font-medium">{formatDateTime(vehicle.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last updated</dt>
              <dd className="text-sm font-medium">{formatDateTime(vehicle.updatedAt)}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <select
              className={cn(
                'h-8 rounded-md border border-input bg-background px-2 text-xs',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              value={vehicle.status}
              onChange={(e) =>
                updateStatus.mutate({ id: vehicle.id, status: e.target.value as (typeof STATUSES)[number] })
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Edit vehicle details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="vehicleCode" className="text-xs font-medium text-muted-foreground">
                Vehicle code
              </Label>
              <Input
                id="vehicleCode"
                value={form.vehicleCode}
                onChange={(e) => setForm((f) => ({ ...f, vehicleCode: e.target.value }))}
                className="w-full sm:w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="registrationNumber" className="text-xs font-medium text-muted-foreground">
                Registration number
              </Label>
              <Input
                id="registrationNumber"
                value={form.registrationNumber}
                onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
                className="w-full sm:w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="vehicleType" className="text-xs font-medium text-muted-foreground">
                Type
              </Label>
              <Input
                id="vehicleType"
                value={form.vehicleType}
                onChange={(e) => setForm((f) => ({ ...f, vehicleType: e.target.value }))}
                className="w-full sm:w-28"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="capacity" className="text-xs font-medium text-muted-foreground">
                Capacity
              </Label>
              <Input
                id="capacity"
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                className="w-full sm:w-24"
              />
            </div>
            <Button type="submit" disabled={updateVehicle.isPending || !isDirty}>
              Save
            </Button>
          </form>
          {updateVehicle.isError && (
            <p className="mt-2 text-sm text-destructive">
              Could not save - that vehicle code may already be in use.
            </p>
          )}
        </CardContent>
      </Card>

      <Link to="/vehicles" className="text-sm text-muted-foreground hover:underline">
        ← Back to all vehicles
      </Link>
    </div>
  );
}
