import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ErrorBanner } from '../common/ErrorBanner';
import { useAppContext } from '../../context/AppContext';
import { LayoutProvider } from '../../context/LayoutContext';
import { usePlaceMemory } from '../../hooks/usePlaceMemory';
import { navGroups } from './navigation';

const SIDEBAR_PATHS = navGroups.flatMap((g) => g.items.map((i) => i.to));

export function AppLayout() {
  const { loading, error } = useAppContext();
  usePlaceMemory(SIDEBAR_PATHS);

  return (
    <LayoutProvider>
      <div className="min-h-screen bg-neutral-50">
        <a href="#main-content" className="skip-nav">
          Skip to main content
        </a>
        <Sidebar />
        <main id="main-content" className="lg:ml-64 min-h-screen">
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorBanner message={error} />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </LayoutProvider>
  );
}
