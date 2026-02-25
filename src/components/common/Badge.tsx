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

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={classNames(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
