import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableSkeleton } from '@/components/table-skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampusLocationsMap } from '@/components/campus-locations-map';
import { cn } from '@/lib/cn';
import {
  useCampusLocations,
  useCreateCampusLocation,
  useSetCampusLocationActive,
} from '@/hooks/useCampusLocations';

const LOCATION_TYPES = [
  'GATE',
  'BUILDING',
  'OFFICE',
  'RESIDENCE',
  'DINING',
  'PARKING',
  'EV_STOP',
  'MEDICAL',
  'RECEPTION',
  'OTHER',
] as const;

export function CampusLocationsPage() {
  const { data: locations, isLoading } = useCampusLocations();
  const createLocation = useCreateCampusLocation();
  const setActive = useSetCampusLocationActive();

  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof LOCATION_TYPES)[number]>('OTHER');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [description, setDescription] = useState('');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!name || Number.isNaN(lat) || Number.isNaN(lng)) return;
    createLocation.mutate(
      { name, type, latitude: lat, longitude: lng, description: description || undefined },
      {
        onSuccess: () => {
          setName('');
          setLatitude('');
          setLongitude('');
          setDescription('');
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a campus location</CardTitle>
          <p className="text-sm text-muted-foreground">
            These are the pickup/destination points the User app will offer - gates, buildings, EV
            stops, etc.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Gate" className="w-full sm:w-48" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <select
                className={cn(
                  'h-9 rounded-md border border-input bg-background px-2 text-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                value={type}
                onChange={(e) => setType(e.target.value as (typeof LOCATION_TYPES)[number])}
              >
                {LOCATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Latitude</label>
              <Input
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="24.5925"
                className="w-full sm:w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Longitude</label>
              <Input
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="72.1234"
                className="w-full sm:w-32"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="optional"
                className="w-full sm:w-48"
              />
            </div>
            <Button type="submit" disabled={createLocation.isPending}>
              Add location
            </Button>
          </form>
          {createLocation.isError && (
            <p className="mt-2 text-sm text-destructive">
              Failed to create location. Check the latitude/longitude values.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campus locations</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton columns={5} />
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
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Coordinates</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations?.map((location) => (
                      <TableRow key={location.id}>
                        <TableCell className="font-medium">{location.name}</TableCell>
                        <TableCell>{location.type}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={location.isActive ? 'success' : 'default'}>
                            {location.isActive ? 'ACTIVE' : 'INACTIVE'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setActive.mutate({ id: location.id, isActive: !location.isActive })
                            }
                          >
                            {location.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {locations?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No campus locations yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TabsContent>
              <TabsContent value="map">
                <CampusLocationsMap locations={locations ?? []} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
