import { useCallback, useState } from 'react';
import { ConfirmDialog } from '../components/common/ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  /** destructive (the default) for archive, deactivate and remove; primary for the rest. */
  variant?: 'primary' | 'destructive';
}

/**
 * Asks before an action, with the shared ConfirmDialog. Render `dialog` once in the
 * page, then call `confirm(options, action)`: the action runs only after the user
 * confirms, and the dialog stays open (buttons disabled) while it does.
 */
export function useConfirm() {
  const [request, setRequest] = useState<(ConfirmOptions & { run: () => void | Promise<void> }) | null>(null);

  const confirm = useCallback((options: ConfirmOptions, run: () => void | Promise<void>) => {
    setRequest({ ...options, run });
  }, []);

  const dialog = (
    <ConfirmDialog
      open={request !== null}
      onClose={() => setRequest(null)}
      onConfirm={async () => { await request?.run(); }}
      title={request?.title ?? ''}
      message={request?.message ?? ''}
      confirmLabel={request?.confirmLabel}
      variant={request?.variant ?? 'destructive'}
    />
  );

  return { confirm, dialog };
}
