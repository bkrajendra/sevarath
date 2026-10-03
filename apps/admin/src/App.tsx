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
                <Route element={<DashboardLayout />}>
                  <Route path="/" element={<DriversPage />} />
                  <Route path="/vehicles" element={<VehiclesPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </BaseProvider>
    </StyletronProvider>
  );
}
