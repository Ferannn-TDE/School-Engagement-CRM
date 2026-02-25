import { Search, Bell } from 'lucide-react';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-sm border-b border-neutral-100">
      <div className="flex items-center justify-between px-8 py-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-800">{title}</h1>
          {subtitle && <p className="text-sm text-neutral-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-4">
          {actions}
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              placeholder="Search..."
              className="pl-10 pr-4 py-2 text-sm border border-neutral-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-siue-red/30 focus:border-siue-red"
              aria-label="Global search"
            />
          </div>
          <button
            className="p-2 rounded-lg hover:bg-neutral-50 text-neutral-400 hover:text-neutral-600 transition-colors relative"
            aria-label="Notifications"
          >
            <Bell size={20} />
          </button>
          <div className="w-8 h-8 rounded-full bg-siue-red text-white flex items-center justify-center text-sm font-semibold">
            A
          </div>
        </div>
      </div>
    </header>
  );
}
