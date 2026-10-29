import type { ReactNode } from 'react';
import { classNames } from '../../utils/helpers';

/** A row's actions: one line, right-aligned, the same order on every row. Clicks don't reach the row. */
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

/**
 * An icon with its label, as a small button. Disabled ones keep their place so columns
 * stay aligned. In a row of several, labels show from 1280px wide and the icons carry a
 * tooltip below that; a lone action (`alwaysLabel`) keeps its label everywhere.
 */
export function RowAction({ icon, label, onClick, tone = 'default', disabled, title, alwaysLabel }: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  tone?: keyof typeof TONES;
  disabled?: boolean;
  title?: string;
  alwaysLabel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={title ?? label}
      className={classNames(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red disabled:cursor-default disabled:text-neutral-400 disabled:hover:bg-transparent',
        TONES[tone],
      )}
    >
      {icon}
      <span className={alwaysLabel ? undefined : 'hidden xl:inline'}>{label}</span>
    </button>
  );
}
