import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-neutral-50">
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>
      <Sidebar />
      <main id="main-content" className="ml-64 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
