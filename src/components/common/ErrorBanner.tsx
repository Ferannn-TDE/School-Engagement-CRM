import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

interface ErrorBannerProps {
  message: string;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 px-8 text-center">
      <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
        <AlertTriangle size={24} className="text-error" />
      </div>
      <div>
        <p className="text-sm font-medium text-neutral-800 mb-1">Failed to load data</p>
        <p className="text-xs text-neutral-400 max-w-sm">{message}</p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => window.location.reload()}
      >
        <RefreshCw size={14} />
        Refresh page
      </Button>
    </div>
  );
}
