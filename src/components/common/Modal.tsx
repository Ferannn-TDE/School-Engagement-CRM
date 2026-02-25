import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';

    // Focus trap: focus the modal content
    contentRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className={`${sizeClasses[size]} w-full bg-white rounded-xl shadow-xl max-h-[90vh] flex flex-col outline-none`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <h2 id="modal-title" className="text-lg font-semibold text-neutral-800">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-neutral-600"
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
