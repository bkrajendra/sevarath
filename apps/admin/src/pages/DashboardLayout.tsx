import { LayoutDashboard, LogOut, MapPin, Route, Car, UserCog, UserRound } from 'lucide-react';
import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/drivers', label: 'Drivers', icon: UserRound },
  { to: '/vehicles', label: 'Vehicles', icon: Car },
  { to: '/campus-locations', label: 'Campus Locations', icon: MapPin },
  { to: '/rides', label: 'Rides', icon: Route },
  // GET /api/v1/users is @Roles('ADMIN') only (docs/open-items.md #40) - hidden
  // below for OPERATOR so that role isn't given a nav link that 404s/403s.
  { to: '/users', label: 'Users', icon: UserCog, adminOnly: true },
];

export function DashboardLayout() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'ADMIN' && user.role !== 'OPERATOR') {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Your account ({user.role}) doesn't have Admin access.
      </div>
    );
  }

  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user.role === 'ADMIN');

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-semibold">
              S
            </div>
            <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
              SevaRath Admin
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNavItems.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild tooltip={item.label}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        className={({ isActive }) => (isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : '')}
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex flex-col gap-2 px-1 pb-1 group-data-[collapsible=icon]:items-center">
            <span className="truncate px-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              {user.role}
            </span>
            <Button variant="outline" size="sm" onClick={logout} className="w-full justify-start gap-2 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <LogOut className="size-4" />
              <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium text-muted-foreground">SevaRath Admin</span>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
