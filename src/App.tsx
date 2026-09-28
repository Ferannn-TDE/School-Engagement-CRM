import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { LoadingSpinner } from './components/common/LoadingSpinner';
import { AppLayout } from './components/layout/AppLayout';
import { RegionScope } from './components/layout/RegionScope';
import { LoginPage } from './pages/LoginPage';
import { SignUpPage } from './pages/SignUpPage';
import { MfaEnrollPage } from './pages/MfaEnrollPage';
import { MfaVerifyPage } from './pages/MfaVerifyPage';
import { DashboardPage } from './pages/DashboardPage';
import { SchoolsPage } from './pages/SchoolsPage';
import { SchoolDetailPage } from './pages/SchoolDetailPage';
import { ContactsPage } from './pages/ContactsPage';
import { EventsPage } from './pages/EventsPage';
import { ImportPage } from './pages/ImportPage';
import { GenerateListsPage } from './pages/GenerateListsPage';
import { ReportsPage } from './pages/ReportsPage';
import { PrioritiesPage } from './pages/PrioritiesPage';
import { SettingsPage } from './pages/SettingsPage';
import { CountiesPage } from './pages/CountiesPage';
import { CountyDetailPage } from './pages/CountyDetailPage';
import { NotFoundPage } from './pages/NotFoundPage';


function MfaGuard() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}


function AuthGuard() {
  const { user, loading, mfaLevel, mfaLoading } = useAuth();

  if (loading || mfaLoading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  if (mfaLevel?.nextLevel === 'aal1') return <Navigate to="/mfa/enroll" replace />;

  if (mfaLevel && mfaLevel.currentLevel !== mfaLevel.nextLevel) {
    return <Navigate to="/mfa/verify" replace />;
  }

  return (
    <AppProvider>
      <Outlet />
    </AppProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route element={<MfaGuard />}>
            <Route path="/mfa/enroll" element={<MfaEnrollPage />} />
            <Route path="/mfa/verify" element={<MfaVerifyPage />} />
          </Route>
          <Route element={<AuthGuard />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              {/* Pages limited by the shared All / IL / MO filter. */}
              <Route element={<RegionScope><Outlet /></RegionScope>}>
                <Route path="/priorities" element={<PrioritiesPage />} />
                <Route path="/schools" element={<SchoolsPage />} />
                <Route path="/contacts" element={<ContactsPage />} />
                <Route path="/events" element={<EventsPage />} />
                <Route path="/generate" element={<GenerateListsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/counties" element={<CountiesPage />} />
              </Route>
              <Route path="/schools/:id" element={<SchoolDetailPage />} />
              <Route path="/import" element={<ImportPage />} />
              {/* Kept so existing bookmarks and links to the old Analytics page still work. */}
              <Route path="/analytics" element={<Navigate to="/reports" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/counties/:state/:countyName" element={<CountyDetailPage />} />
              {/* Older links without a state: redirects, or asks when both states have the name. */}
              <Route path="/counties/:countyName" element={<CountyDetailPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            borderRadius: '10px',
            background: '#373A3C',
            color: '#fff',
            fontSize: '14px',
          },
          success: {
            iconTheme: { primary: '#0F7837', secondary: '#fff' },
          },
          error: {
            iconTheme: { primary: '#C41E3A', secondary: '#fff' },
          },
        }}
      />
    </AuthProvider>
  );
}

export default App;