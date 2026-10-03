import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApproveDriver, useCreateDriver, useDrivers, useSuspendDriver } from '@/hooks/useDrivers';

const statusVariant = {
  PENDING: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'destructive',
  INACTIVE: 'default',
} as const;

export function DriversPage() {
  const { data: drivers, isLoading } = useDrivers();
  const createDriver = useCreateDriver();
  const approveDriver = useApproveDriver();
  const suspendDriver = useSuspendDriver();

  const [userId, setUserId] = useState('');
  const [driverCode, setDriverCode] = useState('');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !driverCode) return;
    createDriver.mutate(
      { userId, driverCode },
      { onSuccess: () => { setUserId(''); setDriverCode(''); } },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Provision a driver</CardTitle>
          <p className="text-sm text-slate-500">
            The user must already exist (e.g. via OTP self-registration) - paste their user id.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">User ID</label>
              <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" className="w-72" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Driver code</label>
              <Input value={driverCode} onChange={(e) => setDriverCode(e.target.value)} placeholder="DRV-001" className="w-40" />
            </div>
            <Button type="submit" disabled={createDriver.isPending}>
              Create driver
            </Button>
          </form>
          {createDriver.isError && (
            <p className="mt-2 text-sm text-red-600">Failed to create driver. Check the user id.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Drivers</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading drivers…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers?.map((driver) => (
                  <TableRow key={driver.id}>
                    <TableCell className="font-medium">{driver.driverCode}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[driver.status]}>{driver.status}</Badge>
                    </TableCell>
                    <TableCell>{driver.availability}</TableCell>
                    <TableCell>{driver.currentVehicleId ?? '-'}</TableCell>
                    <TableCell className="flex gap-2">
                      {driver.status === 'PENDING' && (
                        <Button size="sm" onClick={() => approveDriver.mutate(driver.id)}>
                          Approve
                        </Button>
                      )}
                      {driver.status === 'ACTIVE' && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => suspendDriver.mutate(driver.id)}
                        >
                          Suspend
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {drivers?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500">
                      No drivers yet.
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
