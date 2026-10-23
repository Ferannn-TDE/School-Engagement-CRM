import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

interface ErrorBannerProps {
  message: string;
  title?: string;
  /** Without it, the button reloads the whole page. */
  onRetry?: () => void;
}

export function ErrorBanner({ message, title = 'Failed to load data', onRetry }: ErrorBannerProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center h-64 gap-4 px-8 text-center">
      <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center">
        <AlertTriangle size={24} className="text-error" />
      </div>
      <div>
        <p className="text-sm font-medium text-neutral-800 mb-1">{title}</p>
        <p className="text-xs text-neutral-500 max-w-sm">{message}</p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={onRetry ?? (() => window.location.reload())}
      >
        <RefreshCw size={14} />
        {onRetry ? 'Retry' : 'Refresh page'}
      </Button>
    </div>
  );
}
