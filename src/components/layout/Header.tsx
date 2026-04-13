import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Bell, Menu, School, Users, Calendar } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useLayout } from '../../context/LayoutContext';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  const { state } = useAppContext();
  const { user } = useAuth();
  const { toggleSidebar } = useLayout();
  const navigate = useNavigate();

  const initials = (() => {
    const meta = user?.user_metadata as { full_name?: string } | undefined;
    if (meta?.full_name) {
      const parts = meta.full_name.trim().split(/\s+/);
      return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : parts[0][0].toUpperCase();
    }
    return (user?.email?.split('@')[0]?.[0] ?? 'U').toUpperCase();
  })();

  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const results = useGlobalSearch(query, state);
  const totalResults = results.schools.length + results.contacts.length + results.events.length;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleNavigate(path: string) {
    navigate(path);
    setQuery('');
    setShowResults(false);
  }

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-sm border-b border-neutral-100">
      <div className="flex items-center justify-between px-4 sm:px-8 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSidebar}
            className="lg:hidden p-2 rounded-lg hover:bg-neutral-50 text-neutral-400 hover:text-neutral-600 transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-neutral-800">{title}</h1>
            {subtitle && <p className="text-sm text-neutral-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {actions}

          {/* Global search */}
          <div ref={searchRef} className="relative hidden sm:block">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
            />
            <input
              type="search"
              placeholder="Search..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              className="pl-10 pr-4 py-2 text-sm border border-neutral-200 rounded-lg w-56 lg:w-64 focus:outline-none focus:ring-2 focus:ring-siue-red/30 focus:border-siue-red"
              aria-label="Global search"
            />

            {/* Results dropdown */}
            {showResults && query.trim() && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-xl shadow-lg border border-neutral-100 z-50 overflow-hidden">
                {totalResults === 0 ? (
                  <p className="px-4 py-3 text-sm text-neutral-400">
                    No results for &ldquo;{query}&rdquo;
                  </p>
                ) : (
                  <div className="max-h-80 overflow-y-auto divide-y divide-neutral-50">
                    {results.schools.length > 0 && (
                      <div>
                        <p className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider bg-neutral-50">
                          Schools
                        </p>
                        {results.schools.map((school) => (
                          <button
                            key={school.id}
                            onClick={() => handleNavigate(`/schools/${school.id}`)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 text-left transition-colors"
                          >
                            <School size={15} className="text-neutral-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-neutral-800 truncate">{school.name}</p>
                              <p className="text-xs text-neutral-400">{school.county} County</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {results.contacts.length > 0 && (
                      <div>
                        <p className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider bg-neutral-50">
                          Contacts
                        </p>
                        {results.contacts.map((contact) => (
                          <button
                            key={contact.id}
                            onClick={() => handleNavigate('/contacts')}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 text-left transition-colors"
                          >
                            <Users size={15} className="text-neutral-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-neutral-800 truncate">
                                {contact.firstName} {contact.lastName}
                              </p>
                              <p className="text-xs text-neutral-400 truncate">{contact.email}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {results.events.length > 0 && (
                      <div>
                        <p className="px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider bg-neutral-50">
                          Events
                        </p>
                        {results.events.map((event) => (
                          <button
                            key={event.id}
                            onClick={() => handleNavigate('/events')}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 text-left transition-colors"
                          >
                            <Calendar size={15} className="text-neutral-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-neutral-800 truncate">{event.name}</p>
                              <p className="text-xs text-neutral-400 truncate">{event.location}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            className="p-2 rounded-lg hover:bg-neutral-50 text-neutral-400 hover:text-neutral-600 transition-colors"
            aria-label="Notifications"
          >
            <Bell size={20} />
          </button>
          <div className="w-8 h-8 rounded-full bg-siue-red text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {initials}
          </div>
        </div>
      </div>
    </header>
  );
}
