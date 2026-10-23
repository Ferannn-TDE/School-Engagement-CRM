import { Outlet, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ErrorBanner } from '../common/ErrorBanner';
import { useAppContext, type DataTable } from '../../context/AppContext';
import { LayoutProvider } from '../../context/LayoutContext';
import { usePlaceMemory } from '../../hooks/usePlaceMemory';
import { navGroups } from './navigation';
import { tablesForPath } from './pageTables';

const SIDEBAR_PATHS = navGroups.flatMap((g) => g.items.map((i) => i.to));

const TABLE_NAMES: Record<DataTable, string> = {
  schools: 'schools',
  contacts: 'contacts',
  events: 'events',
  activities: 'activities',
  programs: 'programs',
};

function listNames(tables: DataTable[]) {
  const names = tables.map((t) => TABLE_NAMES[t]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function AppLayout() {
  const { loading, loadErrors, reload } = useAppContext();
  const { pathname } = useLocation();
  usePlaceMemory(SIDEBAR_PATHS);

  const failed = Object.keys(loadErrors) as DataTable[];
  const missingHere = tablesForPath(pathname).filter((t) => loadErrors[t] !== undefined);

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
          ) : missingHere.length > 0 ? (
            <ErrorBanner
              title={`This page needs ${listNames(missingHere)}, which didn't load`}
              message={`${missingHere.map((t) => `${TABLE_NAMES[t]}: ${loadErrors[t]}`).join(' · ')}. Pages that don't need ${missingHere.length === 1 ? 'it' : 'them'} still work.`}
              onRetry={() => void reload()}
            />
          ) : (
            <>
              {failed.length > 0 && (
                <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 text-sm bg-warning/10 border-b border-warning/30 text-neutral-800">
                  <AlertTriangle size={16} className="text-warning shrink-0" />
                  <span>
                    {listNames(failed).replace(/^./, (c) => c.toUpperCase())} didn't load. Pages that need {failed.length === 1 ? 'it' : 'them'} are paused.
                  </span>
                  <button type="button" onClick={() => void reload()} className="font-medium text-siue-red underline hover:text-siue-maroon">
                    Retry
                  </button>
                </div>
              )}
              <Outlet />
            </>
          )}
        </main>
      </div>
    </LayoutProvider>
  );
}
