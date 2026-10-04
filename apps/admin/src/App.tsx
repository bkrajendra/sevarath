import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Client as Styletron } from 'styletron-engine-atomic';
import { Provider as StyletronProvider } from 'styletron-react';
import { BaseProvider, LightTheme } from 'baseui';
import { AuthProvider } from '@/context/AuthContext';
import { LoginPage } from '@/pages/Login';
import { DashboardLayout } from '@/pages/DashboardLayout';
import { DriversPage } from '@/pages/Drivers';
import { VehiclesPage } from '@/pages/Vehicles';
import { CampusLocationsPage } from '@/pages/CampusLocations';
import { DownloadPage } from '@/pages/Download';

const engine = new Styletron();
const queryClient = new QueryClient();

export default function App() {
  return (
    <StyletronProvider value={engine}>
      <BaseProvider theme={LightTheme}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/download" element={<DownloadPage />} />
                <Route element={<DashboardLayout />}>
                  <Route path="/" element={<DriversPage />} />
                  <Route path="/vehicles" element={<VehiclesPage />} />
                  <Route path="/campus-locations" element={<CampusLocationsPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </BaseProvider>
    </StyletronProvider>
  );
}
