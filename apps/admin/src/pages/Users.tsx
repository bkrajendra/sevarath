import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { isForbidden, useUsers, type UserRole } from '@/hooks/useUsers';

/** Copies a user's id (needed to paste into the Drivers page's "Provision a driver" form -
 * that's the only place this id is used anywhere, and the Users table never showed it at all
 * until now). */
function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy user id (${id})`}
      className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const roleVariant = {
  USER: 'default',
  DRIVER: 'default',
  ADMIN: 'success',
  OPERATOR: 'warning',
} as const;

const statusVariant = {
  ACTIVE: 'success',
  PENDING: 'warning',
  SUSPENDED: 'destructive',
} as const;

export function UsersPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [offset, setOffset] = useState(0);

  // Simple debounce - no new dependency needed for one input field.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const { data, isLoading, error } = useUsers({
    role: role || undefined,
    search,
    limit: PAGE_SIZE,
    offset,
  });

  if (isForbidden(error)) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          You don't have access to this page. User management is restricted to Admins.
        </CardContent>
      </Card>
    );
  }
  if (error) throw error;

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Name, mobile, or email"
                className="w-64"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <select
                className={cn(
                  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as UserRole | '');
                  setOffset(0);
                }}
              >
                <option value="">All roles</option>
                <option value="USER">USER</option>
                <option value="DRIVER">DRIVER</option>
                <option value="ADMIN">ADMIN</option>
                <option value="OPERATOR">OPERATOR</option>
              </select>
            </div>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading users…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {user.name}
                        <CopyIdButton id={user.id} />
                      </div>
                    </TableCell>
                    <TableCell>{user.mobile}</TableCell>
                    <TableCell>{user.email ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant={roleVariant[user.role]}>{user.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[user.status]}>{user.status}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(user.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No users match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
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
