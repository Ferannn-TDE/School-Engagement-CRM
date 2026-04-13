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
}

export function MetricCard({ title, value, subtitle, icon }: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl border border-neutral-100 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
      {/* Gradient header strip */}
      <div className="h-1 bg-gradient-to-r from-siue-red/40 via-siue-red/10 to-transparent" />
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">{title}</p>
            <p className="mt-1 text-3xl font-bold text-neutral-800">{value}</p>
            {subtitle && <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>}
          </div>
          {icon && (
            <div className="p-3 rounded-lg bg-siue-red/10 text-siue-red shrink-0">{icon}</div>
          )}
        </div>
      </div>
    </div>
  );
}
