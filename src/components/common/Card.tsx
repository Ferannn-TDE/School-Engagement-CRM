import type { ReactNode } from 'react';
import { classNames } from '../../utils/helpers';

type AccentColor = 'red' | 'blue' | 'green' | 'orange';

const accentClasses: Record<AccentColor, string> = {
  red: 'border-l-[3px] border-l-siue-red',
  blue: 'border-l-[3px] border-l-info',
  green: 'border-l-[3px] border-l-success',
  orange: 'border-l-[3px] border-l-warning',
};

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
  accent?: AccentColor;
}

export function Card({ children, className, padding = true, accent }: CardProps) {
  return (
    <div
      className={classNames(
        'bg-white rounded-xl border border-neutral-100 shadow-sm overflow-hidden',
        accent && accentClasses[accent],
        padding && 'p-6',
        className
      )}
    >
      {children}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  /** Makes the number a button (e.g. scroll to the list it counts). */
  onClick?: () => void;
  actionLabel?: string;
}

export function MetricCard({ title, value, subtitle, icon, onClick, actionLabel }: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl border border-neutral-100 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">{title}</p>
            {onClick ? (
              <button
                type="button"
                onClick={onClick}
                aria-label={actionLabel}
                title={actionLabel}
                className="mt-1 text-3xl font-bold text-neutral-800 underline decoration-dotted decoration-neutral-300 underline-offset-4 hover:text-siue-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-siue-red rounded"
              >
                {typeof value === 'number' ? value.toLocaleString('en-US') : value}
              </button>
            ) : (
              <p className="mt-1 text-3xl font-bold text-neutral-800">{typeof value === 'number' ? value.toLocaleString('en-US') : value}</p>
            )}
            {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
          </div>
          {icon && (
            <div className="p-3 rounded-lg bg-siue-red/10 text-siue-red shrink-0">{icon}</div>
          )}
        </div>
      </div>
    </div>
  );
}
