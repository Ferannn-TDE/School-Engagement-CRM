import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from './context/AppContext';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { SchoolsPage } from './pages/SchoolsPage';
import { SchoolDetailPage } from './pages/SchoolDetailPage';
import { ContactsPage } from './pages/ContactsPage';
import { EventsPage } from './pages/EventsPage';
import { ImportPage } from './pages/ImportPage';
import { GenerateListsPage } from './pages/GenerateListsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/schools" element={<SchoolsPage />} />
            <Route path="/schools/:id" element={<SchoolDetailPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/generate" element={<GenerateListsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
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
    </AppProvider>
  );
}

export default App;
