import { classNames } from '../../utils/helpers';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-neutral-100 text-neutral-600',
  success: 'bg-green-100 text-success',
  warning: 'bg-amber-100 text-warning',
  error: 'bg-red-100 text-error',
  info: 'bg-blue-100 text-info',
};

/** One line always: a long label is cut with an ellipsis and shown in full on hover. */
export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={classNames(
        'inline-flex max-w-full items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap',
        variantStyles[variant],
        className
      )}
      title={typeof children === 'string' ? children : undefined}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
