import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import ProtectedRoute from './components/ProtectedRoute';
import TabShell from './components/TabShell';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ImportPreviewPage from './pages/ImportPreviewPage';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/portfolios/:id/import-preview" element={<ImportPreviewPage />} />
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
