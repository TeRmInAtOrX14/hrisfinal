import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

import { ThemeProvider } from './utils/themeContext';
import { session } from './utils/api';
import { ADMIN_ROLES, ALL_ROLES } from './utils/roles';

import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import OrgChart from './pages/OrgChart';
import Attendance from './pages/Attendance';
import Requests from './pages/Requests';
import Campaigns from './pages/Campaigns';
import Loans from './pages/Loans';
import Payroll from './pages/Payroll';
import Audit from './pages/Audit';
import DigitalTwin from './pages/DigitalTwin';
import NotFound from './pages/NotFound';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

/**
 * Auth gate.
 *
 * Also enforces the first-login password change. `mustChangePassword` has been
 * set on every admin-created account since day one, but nothing in the UI ever
 * acted on it, so staff kept using the password an admin picked for them
 * indefinitely.
 */
function RequireAuth({ children }) {
  const location = useLocation();

  if (!session.accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (session.user?.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return children;
}

/**
 * Role gate.
 *
 * Routes were previously guarded only by hiding links in the sidebar: typing
 * /dashboard/payroll as an SDR still rendered the whole page, which then fired
 * requests that 403'd and left a broken screen full of error toasts. The API was
 * never the problem — the UI just should not offer the page.
 */
function RequireRole({ roles, children }) {
  const role = session.user?.role;

  if (!roles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

const adminOnly = (element) => <RequireRole roles={ADMIN_ROLES}>{element}</RequireRole>;

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              path="/change-password"
              element={
                <RequireAuth>
                  <ChangePassword />
                </RequireAuth>
              }
            />

            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <DashboardLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="employees" element={<Employees />} />
              <Route path="org-chart" element={<OrgChart />} />
              <Route path="attendance" element={<Attendance />} />
              <Route path="requests" element={<Requests />} />
              <Route path="loans" element={<Loans />} />
              <Route path="payroll" element={<Payroll />} />

              <Route path="campaigns" element={adminOnly(<Campaigns />)} />
              <Route path="digital-twin" element={adminOnly(<DigitalTwin />)} />
              <Route path="audit" element={adminOnly(<Audit />)} />
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {/* A real 404 instead of bouncing every unknown path to the dashboard. */}
            <Route path="*" element={<NotFound />} />
          </Routes>

          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: 'var(--brand-bg-elevated)',
                color: 'var(--brand-text)',
                border: '1px solid var(--brand-border)',
                fontSize: '13px',
                maxWidth: '420px',
              },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export { ALL_ROLES };
