import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Bug, CheckCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Textarea } from '../common/Textarea';
import { Button } from '../common/Button';
import { reportContext, submitBugReport } from '../../services/bugReportsService';

/**
 * "Report a problem", on every page: a short form that files a report (db/024) with
 * the page, browser, screen size and app version. The person sees exactly what is sent
 * and gets a reference once it's saved.
 */
export function ReportProblemButton() {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);
  const page = `${pathname}${search}`;
  const ctx = reportContext(page);

  // Stable while typing: Modal refocuses itself whenever onClose changes.
  const close = useCallback(() => {
    setOpen(false);
    // Keep an unsent description in case the form was closed by accident.
    if (sentId) {
      setSentId(null);
      setDescription('');
    }
    setError('');
  }, [sentId]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setSending(true);
    setError('');
    try {
      setSentId(await submitBugReport(page, description));
    } catch (err) {
      console.error('submitBugReport failed:', err);
      setError(
        `Couldn’t send the report (${(err as { message?: string })?.message ?? 'unknown error'}). Your text is still here; try again in a moment.`
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a problem"
        className="fixed z-30 inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-md hover:border-siue-red hover:text-siue-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red"
        style={{
          right: 'calc(1rem + env(safe-area-inset-right, 0px))',
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <Bug size={16} aria-hidden="true" />
        <span className="hidden sm:inline">Report a problem</span>
      </button>

      <Modal open={open} onClose={close} title={sentId ? 'Report sent' : 'Report a problem'}>
        {sentId ? (
          <div role="status" className="space-y-4">
            <p className="flex items-start gap-2 text-sm text-neutral-800">
              <CheckCircle size={18} className="text-success shrink-0 mt-0.5" />
              <span>
                Thank you. Your report was sent, and an admin will see it under Settings → Problem reports.
                Reference <strong className="font-mono">{sentId.slice(0, 8)}</strong>.
              </span>
            </p>
            <div className="flex justify-end">
              <Button onClick={close}>Close</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={send} className="space-y-4">
            <Textarea
              label="What went wrong?"
              required
              rows={5}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What you were doing, what you expected, and what happened instead."
            />
            <p className="text-xs text-neutral-500">
              Sent with it: this page (<span className="font-mono">{ctx.page}</span>), your sign-in email, your
              browser, screen size {ctx.screen.replace('x', '×')} and app version <span className="font-mono">{ctx.appVersion}</span>.
            </p>
            {error && (
              <p role="alert" className="text-sm text-error">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close} disabled={sending}>Cancel</Button>
              <Button type="submit" loading={sending} disabled={sending || !description.trim()}>Send report</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
