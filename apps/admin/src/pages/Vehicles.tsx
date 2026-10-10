import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCreateVehicle, useVehicles } from '@/hooks/useVehicles';

const statusVariant = {
  AVAILABLE: 'success',
  IN_SERVICE: 'default',
  MAINTENANCE: 'warning',
  INACTIVE: 'destructive',
} as const;

export function VehiclesPage() {
  const { data: vehicles, isLoading } = useVehicles();
  const createVehicle = useCreateVehicle();

  const [vehicleCode, setVehicleCode] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [capacity, setCapacity] = useState('4');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicleCode) return;
    createVehicle.mutate(
      {
        vehicleCode,
        registrationNumber: registrationNumber || undefined,
        vehicleType: 'EV',
        capacity: Number(capacity) || 4,
      },
      {
        onSuccess: () => {
          setVehicleCode('');
          setRegistrationNumber('');
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a vehicle</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Vehicle code</label>
              <Input value={vehicleCode} onChange={(e) => setVehicleCode(e.target.value)} placeholder="EV-01" className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Registration number</label>
              <Input
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="MH-12-AB-3456"
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Capacity</label>
              <Input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className="w-24"
              />
            </div>
            <Button type="submit" disabled={createVehicle.isPending}>
              Add vehicle
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicles</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading vehicles…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Registration number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles?.map((vehicle) => (
                  <TableRow key={vehicle.id}>
                    <TableCell className="font-medium">{vehicle.vehicleCode}</TableCell>
                    <TableCell>{vehicle.registrationNumber ?? '-'}</TableCell>
                    <TableCell>{vehicle.vehicleType}</TableCell>
                    <TableCell>{vehicle.capacity}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[vehicle.status]}>{vehicle.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {vehicles?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No vehicles yet.
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
