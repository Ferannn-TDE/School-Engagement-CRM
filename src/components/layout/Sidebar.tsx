import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  School,
  Users,
  Calendar,
  Download,
  Upload,
  BarChart3,
  Settings,
} from 'lucide-react';
import { classNames } from '../../utils/helpers';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/schools', icon: School, label: 'Schools' },
  { to: '/contacts', icon: Users, label: 'Contacts' },
  { to: '/events', icon: Calendar, label: 'Events' },
  { to: '/import', icon: Download, label: 'Import Data' },
  { to: '/generate', icon: Upload, label: 'Generate Lists' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-neutral-100 flex flex-col z-40">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-neutral-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-siue-red rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">SoE</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-neutral-800 leading-tight">SIUE Engineering</h1>
            <p className="text-xs text-neutral-400">Engagement CRM</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              classNames(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-siue-red/10 text-siue-red'
                  : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
              )
            }
          >
            <item.icon size={20} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-neutral-100">
        <p className="text-xs text-neutral-400">School of Engineering</p>
        <p className="text-xs text-neutral-300">Southern Illinois University Edwardsville</p>
      </div>
    </aside>
  );
}
