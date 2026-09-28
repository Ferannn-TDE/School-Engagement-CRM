import { NavLink, useLocation } from 'react-router-dom';
import { classNames } from '../../utils/helpers';
import { useLayout } from '../../context/LayoutContext';
import { rememberedUrl } from '../../hooks/usePlaceMemory';
import { navGroups } from './navigation';

export function Sidebar() {
  const { sidebarOpen, closeSidebar } = useLayout();
  // Re-render on every navigation so each link points at that page's last address.
  useLocation();

  return (
    <>
      {/* Backdrop — mobile only, closes sidebar on tap */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          aria-hidden="true"
          onClick={closeSidebar}
        />
      )}

      <aside
        className={classNames(
          'fixed left-0 top-0 h-screen w-64 bg-white border-r border-neutral-100 flex flex-col z-40',
          'transition-transform duration-300',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="px-6 py-5 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-siue-red rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">SoE</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-neutral-800 leading-tight">SIUE Engineering</h1>
              <p className="text-xs text-neutral-500">Engagement CRM</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto" aria-label="Main navigation">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="px-3 pt-3 pb-1 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={rememberedUrl(item.to)}
                    end={item.to === '/'}
                    onClick={closeSidebar}
                    className={({ isActive }) =>
                      classNames(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-neutral-100 text-siue-red'
                          : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
                      )
                    }
                  >
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-100">
          <p className="text-xs text-neutral-500">School of Engineering</p>
          <p className="text-xs text-neutral-500">Southern Illinois University Edwardsville</p>
        </div>
      </aside>
    </>
  );
}
