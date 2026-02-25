import type { ReactNode } from 'react';
import { classNames } from '../../utils/helpers';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div
      className={classNames(
        'bg-white rounded-xl border border-neutral-100 shadow-sm',
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
  trend?: { value: number; label: string };
}

export function MetricCard({ title, value, subtitle, icon, trend }: MetricCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500">{title}</p>
          <p className="mt-1 text-3xl font-bold text-neutral-800">{value}</p>
          {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
          {trend && (
            <p
              className={classNames(
                'mt-1 text-sm font-medium',
                trend.value >= 0 ? 'text-success' : 'text-error'
              )}
            >
              {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
            </p>
          )}
        </div>
        {icon && (
          <div className="p-3 rounded-lg bg-siue-red/10 text-siue-red">{icon}</div>
        )}
      </div>
    </Card>
  );
}
