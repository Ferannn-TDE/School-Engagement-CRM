import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  Download,
  Info,
  CheckCircle,
  Shield,
  LogOut,
  Bug,
  Users,
  Database,
  UserCircle,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { useAppContext } from '../context/useAppContext';
import { useAuth } from '../context/useAuth';
import { downloadFile } from '../utils/helpers';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useRole } from '../context/useRole';

const linkButton =
  'inline-flex min-h-10 items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white text-siue-red border border-siue-red hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red';

/** One card in the Settings grid: icon, title, what it's for, and its action at the bottom. */
function SettingsCard({ icon, tone = 'brand', title, description, action, children }: {
  icon: ReactNode;
  tone?: 'brand' | 'info' | 'neutral';
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const iconTone = tone === 'brand' ? 'bg-siue-red/10 text-siue-red' : tone === 'info' ? 'bg-info/10 text-info' : 'bg-neutral-100 text-neutral-500';
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start gap-3 mb-3">
        <div className={`p-2 rounded-lg shrink-0 ${iconTone}`}>{icon}</div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-neutral-800">{title}</h2>
          <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
        </div>
      </div>
      {children}
      {action && <div className="mt-auto pt-4">{action}</div>}
    </Card>
  );
}

export function SettingsPage() {
  const { state } = useAppContext();
  const { user, signOut } = useAuth();
  const { role, isAdmin, rolesEnabled } = useRole();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const handleExportDatabase = () => {
    const data = {
      schools: state.schools,
      contacts: state.contacts,
      events: state.events,
      activities: state.activities,
    };
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `siue-crm-backup-${format(new Date(), 'yyyy-MM-dd')}.json`, 'application/json');
    toast.success('Database exported successfully');
  };

  return (
    <div>
<Header
        title="Settings"
        subtitle="Database management and application settings"
      />
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <SettingsCard
            icon={<Download size={20} />}
            title="Export database"
            description="Download a JSON snapshot of all current schools, contacts, events and activities from the live database."
            action={
              <Button size="sm" variant="secondary" onClick={handleExportDatabase}>
                <Download size={15} />
                Export
              </Button>
            }
          />

          <SettingsCard
            icon={<Archive size={20} />}
            title="Archived items"
            description="Schools, contacts, events, programs and logged contacts are archived, never deleted. See who archived what and when, and restore anything."
            action={<Link to="/settings/archived" className={linkButton}><Archive size={15} />View archived</Link>}
          />

          <SettingsCard
            icon={<Bug size={20} />}
            title="Problem reports"
            description="Reports sent with the Report a problem button, with the page and browser. Admins mark them resolved and archive them."
            action={<Link to="/settings/problem-reports" className={linkButton}><Bug size={15} />View reports</Link>}
          />

          {isAdmin && (
            <SettingsCard
              icon={<Users size={20} />}
              title="Team"
              description="Every account and its role (admin, editor, viewer), and the log of every change. Admins only."
              action={<Link to="/settings/team" className={linkButton}><Users size={15} />Manage team</Link>}
            />
          )}

          <SettingsCard
            icon={<UserCircle size={20} />}
            tone="neutral"
            title="Account"
            description={`Signed in as ${user?.email ?? 'unknown'}${rolesEnabled ? ` · ${role === 'admin' ? 'Admin' : role === 'editor' ? 'Editor' : 'Viewer (read only)'}` : ''}`}
            action={
              <Button variant="secondary" size="sm" onClick={() => setShowSignOutConfirm(true)}>
                <LogOut size={16} />
                Sign out
              </Button>
            }
          />

          <SettingsCard
            icon={<Shield size={20} />}
            tone="info"
            title="Data storage"
            description="How your data is stored"
          >
            <div className="text-sm text-neutral-600 space-y-2">
              <p className="flex items-start gap-2">
                <CheckCircle size={16} className="text-success mt-0.5 shrink-0" />
                Schools, contacts, events and activities are stored in a Supabase cloud database, shared across all browsers and sessions.
              </p>
              <p className="flex items-start gap-2">
                <CheckCircle size={16} className="text-success mt-0.5 shrink-0" />
                Use Export database to download a local backup of all data.
              </p>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={<Info size={20} />}
            tone="neutral"
            title="About"
            description="Application information"
          >
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-neutral-500 uppercase tracking-wider">Application</dt>
                <dd className="mt-0.5 font-medium text-neutral-700">SIUE Engineering Engagement CRM</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500 uppercase tracking-wider">Version</dt>
                <dd className="mt-0.5 font-medium text-neutral-700">1.0.0</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500 uppercase tracking-wider">Organization</dt>
                <dd className="mt-0.5 font-medium text-neutral-700">SIUE School of Engineering</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500 uppercase tracking-wider">Purpose</dt>
                <dd className="mt-0.5 font-medium text-neutral-700">K-12 Outreach Tracking</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500 uppercase tracking-wider">Tech Stack</dt>
                <dd className="mt-0.5 font-medium text-neutral-700">React 19 · TypeScript · Tailwind v4 · Recharts</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500 uppercase tracking-wider">Storage</dt>
                <dd className="mt-0.5 font-medium text-neutral-700 inline-flex items-center gap-1"><Database size={13} />Supabase (cloud)</dd>
              </div>
            </dl>
          </SettingsCard>
        </div>
      </div>

      <ConfirmDialog
        open={showSignOutConfirm}
        onClose={() => setShowSignOutConfirm(false)}
        onConfirm={signOut}
        title="Sign out"
        message="You'll be returned to the sign-in screen. No data is changed or lost."
        confirmLabel="Sign out"
        variant="secondary"
      />
    </div>
  );
}
