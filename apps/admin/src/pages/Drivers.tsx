import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import {
  useApproveDriver,
  useAssignVehicle,
  useCreateDriver,
  useDrivers,
  useProvisionDriver,
  useSuspendDriver,
} from '@/hooks/useDrivers';
import { useVehicles } from '@/hooks/useVehicles';

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

const statusVariant = {
  PENDING: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'destructive',
  INACTIVE: 'default',
} as const;

export function DriversPage() {
  const { data: drivers, isLoading } = useDrivers();
  const { data: vehicles } = useVehicles();
  const createDriver = useCreateDriver();
  const provisionDriver = useProvisionDriver();
  const approveDriver = useApproveDriver();
  const suspendDriver = useSuspendDriver();
  const assignVehicle = useAssignVehicle();

  const [userId, setUserId] = useState('');
  const [driverCode, setDriverCode] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<Record<string, string>>({});

  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDriverCode, setNewDriverCode] = useState('');
  const [provisioned, setProvisioned] = useState<{
    driverCode: string;
    mobile: string;
    temporaryPassword: string;
    emailSent: boolean;
  } | null>(null);

  const vehicleCodeById = new Map(vehicles?.map((v) => [v.id, v.vehicleCode]));

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!userId || !driverCode) return;
    createDriver.mutate(
      { userId, driverCode },
      { onSuccess: () => { setUserId(''); setDriverCode(''); } },
    );
  }

  function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    if (!newName || !newMobile || !newDriverCode) return;
    provisionDriver.mutate(
      { name: newName, mobile: newMobile, email: newEmail || undefined, driverCode: newDriverCode },
      {
        onSuccess: (data) => {
          if (!data) return;
          setProvisioned({
            driverCode: newDriverCode,
            mobile: newMobile,
            temporaryPassword: data.temporaryPassword,
            emailSent: data.emailSent,
          });
          setNewName('');
          setNewMobile('');
          setNewEmail('');
          setNewDriverCode('');
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a driver account</CardTitle>
          <p className="text-sm text-muted-foreground">
            Creates the account directly - the driver doesn't need to register themselves first.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProvision} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ravi Kumar" className="w-48" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Mobile</label>
              <Input value={newMobile} onChange={(e) => setNewMobile(e.target.value)} placeholder="+911234567890" className="w-44" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Email (optional)</label>
              <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="ravi@example.com" className="w-56" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Driver code</label>
              <Input value={newDriverCode} onChange={(e) => setNewDriverCode(e.target.value)} placeholder="DRV-001" className="w-32" />
            </div>
            <Button type="submit" disabled={provisionDriver.isPending}>
              Create account
            </Button>
          </form>
          {provisionDriver.isError && (
            <p className="mt-2 text-sm text-destructive">
              Failed to create the account. The mobile number or email may already be in use.
            </p>
          )}
          {provisioned && (
            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-900">
                Account created for {provisioned.driverCode} ({provisioned.mobile}).
                {provisioned.emailSent
                  ? ' Login credentials were also emailed to them.'
                  : ' Share these credentials with them now - they will not be shown again.'}
              </p>
              <div className="flex items-center gap-2 rounded-md bg-background px-3 py-2 font-mono text-sm">
                <span className="text-muted-foreground">Password:</span>
                <span>{provisioned.temporaryPassword}</span>
                <CopyButton value={provisioned.temporaryPassword} label="Copy" />
              </div>
              <Button size="sm" variant="outline" className="w-fit" onClick={() => setProvisioned(null)}>
                Dismiss
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provision an existing user as a driver</CardTitle>
          <p className="text-sm text-muted-foreground">
            For a user who already has an account (e.g. via OTP self-registration) - paste their user id.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">User ID</label>
              <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" className="w-72" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Driver code</label>
              <Input value={driverCode} onChange={(e) => setDriverCode(e.target.value)} placeholder="DRV-001" className="w-40" />
            </div>
            <Button type="submit" disabled={createDriver.isPending}>
              Create driver
            </Button>
          </form>
          {createDriver.isError && (
            <p className="mt-2 text-sm text-destructive">Failed to create driver. Check the user id.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Drivers</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading drivers…</p>
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
                    <TableCell>
                      {driver.currentVehicleId
                        ? (vehicleCodeById.get(driver.currentVehicleId) ?? driver.currentVehicleId)
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
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
                          value={selectedVehicle[driver.id] ?? ''}
                          onChange={(e) =>
                            setSelectedVehicle((prev) => ({ ...prev, [driver.id]: e.target.value }))
                          }
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
                          disabled={!selectedVehicle[driver.id] || assignVehicle.isPending}
                          onClick={() =>
                            assignVehicle.mutate({ id: driver.id, vehicleId: selectedVehicle[driver.id] })
                          }
                        >
                          Assign
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {drivers?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
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
