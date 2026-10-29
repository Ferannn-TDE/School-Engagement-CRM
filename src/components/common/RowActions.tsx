import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { classNames } from '../../utils/helpers';

/** A row's actions: one line, the same order on every row. Clicks don't reach the row. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

const TONES = {
  default: 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900',
  primary: 'text-siue-red hover:bg-siue-red/10',
  danger: 'text-neutral-700 hover:bg-error/10 hover:text-error',
};

/** An icon with its label, as a small button. For rows with one or two actions. */
export function RowAction({ icon, label, onClick, tone = 'default', disabled, title }: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  tone?: keyof typeof TONES;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={classNames(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red disabled:cursor-default disabled:text-neutral-400 disabled:hover:bg-transparent',
        TONES[tone],
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export interface RowMenuItem {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Shown instead of the label when disabled, e.g. "Verified". */
  disabledLabel?: string;
}

/**
 * An "Actions" button that opens the row's actions as a labeled list: for rows with
 * three or more actions, so the column keeps one fixed width at every screen size.
 * The list is drawn over the page (not inside the table), so a scrolling table never
 * clips it; it closes on a choice, Escape, a click elsewhere, scrolling or resizing.
 */
export function RowMenu({ items, label = 'Actions', name }: { items: RowMenuItem[]; label?: string; name?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < items.length * 36 + 24;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, right: window.innerWidth - r.right, up });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, pos]);

  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name ? `Actions for ${name}` : label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red"
      >
        {label}
        <ChevronDown size={13} className={classNames('transition-transform', open && 'rotate-180')} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menu}
          role="menu"
          className="fixed z-50 min-w-[10rem] rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
          style={{ top: pos.top, right: pos.right, transform: pos.up ? 'translateY(-100%)' : undefined }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick(); }}
              className={classNames(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                'focus-visible:outline-none focus-visible:bg-neutral-100 disabled:cursor-default disabled:text-neutral-400 disabled:hover:bg-transparent',
                item.tone === 'danger' ? 'text-neutral-700 hover:bg-error/10 hover:text-error' : 'text-neutral-700 hover:bg-neutral-100',
              )}
            >
              {item.icon}
              {item.disabled && item.disabledLabel ? item.disabledLabel : item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
