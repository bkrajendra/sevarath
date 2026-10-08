import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

interface NavItem {
  to: string;
  label: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/drivers', label: 'Drivers' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/campus-locations', label: 'Campus Locations' },
  { to: '/rides', label: 'Rides' },
  // GET /api/v1/users is @Roles('ADMIN') only (docs/open-items.md #40) - hidden
  // below for OPERATOR so that role isn't given a nav link that 404s/403s.
  { to: '/users', label: 'Users', adminOnly: true },
];

export function DashboardLayout() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'ADMIN' && user.role !== 'OPERATOR') {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Your account ({user.role}) doesn't have Admin access.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold">SevaRath Admin</span>
          <nav className="flex gap-4">
            {navItems
              .filter((item) => !item.adminOnly || user.role === 'ADMIN')
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `text-sm ${isActive ? 'font-medium text-slate-900' : 'text-slate-500 hover:text-slate-700'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
          </nav>
        </div>
        <Button variant="outline" size="sm" onClick={logout}>
          Sign out
        </Button>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
