import type { ReactNode } from 'react';
import { classNames } from '../../utils/helpers';

/**
 * Text on one line, cut with an ellipsis and shown in full on hover, so a long value
 * never makes a table row taller. `title` defaults to the text itself.
 */
export function OneLine({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      className={classNames('block min-w-0 truncate', className)}
      title={title ?? (typeof children === 'string' ? children : undefined)}
    >
      {children}
    </span>
  );
}
