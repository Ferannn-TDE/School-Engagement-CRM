import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

/**
 * Variants mirror Button's own set rather than a private list, so a caller can
 * pick the weight that matches the action. `destructive` (alert red, not brand
 * red) is the default because most callers here are deletes; non-destructive
 * confirmations like signing out should pass something lighter.
 */
type ConfirmVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * May return a promise. While it is pending the dialog stays open with both
   * buttons disabled, so a slow delete cannot be fired twice. The dialog closes
   * only on success — if the handler throws, it stays open and re-enables.
   */
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: ConfirmVariant;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'destructive',
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setPending(false);
    }
  };

  // Escape, the overlay and the X all route through Modal's onClose. Freeze
  // every one of them while the action is in flight so a half-finished delete
  // cannot be dismissed out from under itself.
  const handleClose = () => {
    if (pending) return;
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={title} size="sm">
      <p className="text-sm text-neutral-600 mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={handleClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant={variant} onClick={() => void handleConfirm()} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
