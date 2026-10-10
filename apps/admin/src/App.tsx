import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/context/AuthContext';
import { LoginPage } from '@/pages/Login';
import { DashboardLayout } from '@/pages/DashboardLayout';
import { DashboardPage } from '@/pages/Dashboard';
import { DriversPage } from '@/pages/Drivers';
import { VehiclesPage } from '@/pages/Vehicles';
import { CampusLocationsPage } from '@/pages/CampusLocations';
import { UsersPage } from '@/pages/Users';
import { RidesPage } from '@/pages/Rides';
import { DownloadPage } from '@/pages/Download';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/download" element={<DownloadPage />} />
              <Route element={<DashboardLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/drivers" element={<DriversPage />} />
                <Route path="/vehicles" element={<VehiclesPage />} />
                <Route path="/campus-locations" element={<CampusLocationsPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/rides" element={<RidesPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
