import { classNames } from '../../utils/helpers';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  /** Let a long label (a job title) wrap onto more lines instead of being cut. */
  wrap?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-neutral-100 text-neutral-600',
  success: 'bg-green-100 text-success',
  warning: 'bg-amber-100 text-warning',
  error: 'bg-red-100 text-error',
  info: 'bg-blue-100 text-info',
};

/**
 * One line by default: a long label is cut with an ellipsis and shown in full on
 * hover. With `wrap`, it wraps instead, as a rounded box rather than a pill.
 */
export function Badge({ children, variant = 'default', className, wrap }: BadgeProps) {
  return (
    <span
      className={classNames(
        'inline-flex max-w-full items-center px-2.5 py-0.5 text-xs font-medium',
        wrap ? 'rounded-md leading-snug whitespace-normal break-words' : 'rounded-full whitespace-nowrap',
        variantStyles[variant],
        className
      )}
      title={!wrap && typeof children === 'string' ? children : undefined}
    >
      <span className={wrap ? 'min-w-0' : 'min-w-0 truncate'}>{children}</span>
    </span>
  );
}
