import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="p-4 rounded-full bg-neutral-100 text-neutral-400 mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-neutral-700 mb-1">{title}</h3>
      <p className="text-sm text-neutral-400 max-w-md mb-6">{description}</p>
      {action}
    </div>
  );
}
