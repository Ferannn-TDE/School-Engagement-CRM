import { useState, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  RotateCcw,
  Info,
  CheckCircle,
  Shield,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { useAppContext } from '../context/AppContext';
import { seedSchools, seedContacts, seedEvents, seedActivities } from '../constants/seedData';
import { exportDatabase, importDatabase } from '../utils/storage';
import { downloadFile } from '../utils/helpers';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

export function SettingsPage() {
  const { dispatch } = useAppContext();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportDatabase = () => {
    const json = exportDatabase();
    downloadFile(json, `siue-crm-backup-${format(new Date(), 'yyyy-MM-dd')}.json`, 'application/json');
    toast.success('Database exported successfully');
  };

  const handleImportDatabase = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const json = ev.target?.result as string;
      const ok = importDatabase(json);
      if (ok) {
        toast.success('Database imported. Reload the page to see changes.');
      } else {
        toast.error('Failed to import — invalid file format.');
      }
    };
    reader.readAsText(file);
    // reset input so re-selecting same file works
    e.target.value = '';
  };

  const handleResetToSeed = () => {
    dispatch({
      type: 'LOAD_STATE',
      payload: {
        schools: seedSchools,
        contacts: seedContacts,
        events: seedEvents,
        activities: seedActivities,
      },
    });
    toast.success('Data reset to demo data successfully');
  };

  return (
    <div>
      <Header
        title="Settings"
        subtitle="Database management and application settings"
      />
      <div className="p-8 space-y-6 max-w-3xl">

        {/* Database Management */}
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg bg-siue-red/10">
              <Database size={20} className="text-siue-red" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-800">Database Management</h2>
              <p className="text-xs text-neutral-400">Export, import, or reset your CRM data</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between p-4 rounded-lg border border-neutral-100 bg-neutral-50">
              <div>
                <p className="text-sm font-medium text-neutral-700">Export Database</p>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Download a full JSON backup of all schools, contacts, events, and activities.
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={handleExportDatabase}>
                <Download size={15} />
                Export
              </Button>
            </div>

            <div className="flex items-start justify-between p-4 rounded-lg border border-neutral-100 bg-neutral-50">
              <div>
                <p className="text-sm font-medium text-neutral-700">Import Database</p>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Restore from a previously exported JSON backup file.
                </p>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImportDatabase}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={15} />
                  Import
                </Button>
              </div>
            </div>

            <div className="flex items-start justify-between p-4 rounded-lg border border-red-100 bg-red-50">
              <div>
                <p className="text-sm font-medium text-neutral-700">Reset to Demo Data</p>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Wipe all current data and reload the built-in sample dataset. This cannot be undone.
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setShowResetConfirm(true)}
              >
                <RotateCcw size={15} />
                Reset
              </Button>
            </div>
          </div>
        </Card>

        {/* Storage Info */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-info/10">
              <Shield size={20} className="text-info" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-800">Data Storage</h2>
              <p className="text-xs text-neutral-400">How your data is stored</p>
            </div>
          </div>
          <div className="text-sm text-neutral-600 space-y-2">
            <p className="flex items-start gap-2">
              <CheckCircle size={16} className="text-success mt-0.5 shrink-0" />
              All data is stored locally in your browser's LocalStorage under the key prefix{' '}
              <code className="text-xs font-mono bg-neutral-100 px-1.5 py-0.5 rounded">siue_crm_</code>.
            </p>
            <p className="flex items-start gap-2">
              <CheckCircle size={16} className="text-success mt-0.5 shrink-0" />
              No data is sent to any server — this is a fully offline application.
            </p>
            <p className="flex items-start gap-2">
              <CheckCircle size={16} className="text-success mt-0.5 shrink-0" />
              Use the Export function above to back up your data before clearing browser storage.
            </p>
          </div>
        </Card>

        {/* About */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-neutral-100">
              <Info size={20} className="text-neutral-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-800">About</h2>
              <p className="text-xs text-neutral-400">Application information</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-neutral-400 uppercase tracking-wider">Application</dt>
              <dd className="mt-0.5 font-medium text-neutral-700">SIUE Engineering Engagement CRM</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400 uppercase tracking-wider">Version</dt>
              <dd className="mt-0.5 font-medium text-neutral-700">1.0.0</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400 uppercase tracking-wider">Organization</dt>
              <dd className="mt-0.5 font-medium text-neutral-700">SIUE School of Engineering</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400 uppercase tracking-wider">Purpose</dt>
              <dd className="mt-0.5 font-medium text-neutral-700">K-12 Outreach Tracking</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400 uppercase tracking-wider">Tech Stack</dt>
              <dd className="mt-0.5 font-medium text-neutral-700">React 19 · TypeScript · Tailwind v4 · Recharts</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-400 uppercase tracking-wider">Storage</dt>
              <dd className="mt-0.5 font-medium text-neutral-700">Browser LocalStorage (offline)</dd>
            </div>
          </dl>
        </Card>
      </div>

      <ConfirmDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleResetToSeed}
        title="Reset to Demo Data"
        message="This will permanently replace all your current data with the built-in sample dataset. This action cannot be undone. Are you sure?"
        confirmLabel="Reset Data"
        variant="destructive"
      />
    </div>
  );
}
