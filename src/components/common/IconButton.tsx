import type { ReactNode } from 'react';
import { classNames } from '../../utils/helpers';

const TONES = {
  default: 'text-neutral-600 hover:text-neutral-900 hover:border-neutral-200 focus-visible:text-neutral-900',
  danger: 'text-neutral-600 hover:text-error hover:border-error/30 focus-visible:text-error',
};

/**
 * An icon that opens out to show its label on hover and keyboard focus, for row
 * actions that would otherwise crowd a row. The label is always the accessible name
 * (aria-label). With reduced motion it appears without the slide; on touch screens,
 * which can't hover, the label is always shown (and may wrap onto two lines).
 * A destructive action keeps its own confirm step: this is only the button.
 */
export function IconButton({ icon, label, onClick, tone = 'default', disabled, className }: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  tone?: keyof typeof TONES;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        'group/ib relative z-0 inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-transparent bg-white px-2 text-xs font-medium',
        'transition-colors hover:z-10 hover:shadow-sm focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red',
        'pointer-coarse:min-h-10 pointer-coarse:min-w-10',
        'disabled:cursor-default disabled:text-neutral-400 disabled:hover:border-transparent disabled:hover:shadow-none',
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0">{icon}</span>
      {/* 0fr → 1fr on the grid column slides the label open; overflow-hidden lets it close to nothing. */}
      <span
        aria-hidden="true"
        className={classNames(
          'grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none',
          'group-hover/ib:grid-cols-[1fr] group-focus-visible/ib:grid-cols-[1fr]',
          '[@media(hover:none)]:grid-cols-[1fr]',
        )}
      >
        <span className="overflow-hidden whitespace-nowrap text-left [@media(hover:none)]:whitespace-normal">
          <span className="block pl-1.5">{label}</span>
        </span>
      </span>
    </button>
  );
}
