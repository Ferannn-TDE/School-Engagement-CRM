import { useRef, useState, type ReactNode } from 'react';
import { classNames } from '../../utils/helpers';

const TONES = {
  default: 'group-hover/ib:border-neutral-200 group-hover/ib:text-neutral-900 group-focus-visible/ib:text-neutral-900',
  danger: 'group-hover/ib:border-error/30 group-hover/ib:text-error group-focus-visible/ib:text-error',
};

/**
 * An icon that opens out to show its label on hover and keyboard focus, for row
 * actions that would otherwise crowd a row. The label is always the accessible name
 * (aria-label). A destructive action keeps its own confirm step: this is only the button.
 *
 * The button itself stays icon-sized, so it never widens its column or moves anything.
 * What opens is a layer on top of it, anchored to its right edge: the label slides out
 * to the left, over whatever is beside it, on a white background with a shadow. It is
 * the same height as the button, so a table cell or a scrolling table never clips it.
 * If there isn't room on the left (the button sits at the left edge of a card, as on a
 * wrapped Recent imports row), it opens to the right instead, so the label always shows.
 * With reduced motion it appears without the slide. On touch screens, which can't
 * hover, there is no layer: the label is always shown in the button (and may wrap).
 */
export function IconButton({ icon, label, onClick, tone = 'default', disabled, className }: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  tone?: keyof typeof TONES;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [side, setSide] = useState<'left' | 'right'>('left');
  // Measured as it opens: the layer's full width against the nearest box that would clip it.
  const pickSide = () => {
    const button = ref.current;
    const layer = button?.lastElementChild as HTMLElement | null;
    if (!button || !layer) return;
    const text = layer.querySelector('[data-label]') as HTMLElement | null;
    const open = layer.offsetWidth + (text?.scrollWidth ?? 0);
    let limit = 0;
    for (let el = button.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        limit = el.getBoundingClientRect().left;
        break;
      }
    }
    setSide(button.getBoundingClientRect().right - open < limit ? 'right' : 'left');
  };
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      onClick={onClick}
      onPointerEnter={pickSide}
      onFocus={pickSide}
      disabled={disabled}
      className={classNames(
        'group/ib relative z-0 inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-transparent px-2 text-xs font-medium text-neutral-600',
        'hover:z-20 focus-visible:z-20 focus-visible:outline-none',
        'pointer-coarse:min-h-10 pointer-coarse:min-w-10',
        'disabled:cursor-default disabled:text-neutral-400',
        // Touch screens: no layer, so the button shows its own focus ring.
        '[@media(hover:none)]:focus-visible:ring-2 [@media(hover:none)]:focus-visible:ring-siue-red',
        className,
      )}
    >
      {/* In the flow: holds the icon's place (the layer draws it), and on touch screens is the whole button. */}
      <span aria-hidden="true" className="shrink-0 invisible [@media(hover:none)]:visible">{icon}</span>
      <span aria-hidden="true" className="hidden pl-1.5 text-left [@media(hover:none)]:block">{label}</span>

      {/* The layer: right edge on the button's right edge, opening leftward (or the mirror image). */}
      <span
        aria-hidden="true"
        className={classNames(
          'absolute inset-y-[-1px] flex w-max min-w-[calc(100%+2px)] items-center justify-center rounded-md border border-transparent px-2',
          'transition-[box-shadow,border-color,background-color] duration-200 motion-reduce:transition-none',
          'group-hover/ib:bg-white group-hover/ib:shadow-md group-focus-visible/ib:bg-white group-focus-visible/ib:shadow-md',
          'group-focus-visible/ib:ring-2 group-focus-visible/ib:ring-siue-red',
          side === 'left' ? 'right-[-1px]' : 'left-[-1px] flex-row-reverse',
          TONES[tone],
          'group-disabled/ib:text-neutral-400 group-disabled/ib:border-neutral-200',
          '[@media(hover:none)]:hidden',
        )}
      >
        {/* 0fr → 1fr on the grid column slides the label open; overflow-hidden lets it close to nothing. */}
        <span
          className={classNames(
            'grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none',
            'group-hover/ib:grid-cols-[1fr] group-focus-visible/ib:grid-cols-[1fr]',
          )}
        >
          <span className="overflow-hidden whitespace-nowrap">
            <span data-label className={side === 'left' ? 'block pr-1.5' : 'block pl-1.5'}>{label}</span>
          </span>
        </span>
        <span className="shrink-0">{icon}</span>
      </span>
    </button>
  );
}
