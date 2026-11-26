import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import ProtectedRoute from './components/ProtectedRoute';
import TabShell from './components/TabShell';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import ManageSecurityQuestionsPage from './pages/ManageSecurityQuestionsPage';
import ImportPreviewPage from './pages/ImportPreviewPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          {/* Public - this is exactly the flow for someone who's locked out and has no
              session at all (Self-Registration & Password Policy). */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/security-questions" element={<ManageSecurityQuestionsPage />} />
            <Route path="/portfolios/:id/import-preview" element={<ImportPreviewPage />} />
            {/* Static segments like /admin rank above the /* splat below regardless of
                declaration order (React Router v6), so this is safely matched first. A
                dedicated full-screen route, not nested in TabShell - Admin Console Phase 7. */}
            <Route path="/admin" element={<AdminPage />} />
            {/* Single route match for every tab (/, /momentum, /contrarian-finder,
                /long-term-analysis, /contrarian-comeback) - TabShell itself never
                unmounts across these, only the visible tab panel changes, which is
                what lets a tab keep its in-progress state when you switch away and back. */}
            <Route path="/*" element={<TabShell />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
