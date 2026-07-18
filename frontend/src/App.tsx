import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import ContrarianFinderPage from './pages/ContrarianFinderPage';
import MomentumPage from './pages/MomentumPage';
import ImportPreviewPage from './pages/ImportPreviewPage';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/contrarian-finder" element={<ContrarianFinderPage />} />
            <Route path="/momentum" element={<MomentumPage />} />
            <Route path="/portfolios/:id/import-preview" element={<ImportPreviewPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
