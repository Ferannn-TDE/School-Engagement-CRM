import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Badge } from './Badge';

type TagVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface BreadcrumbCrumb {
  label: string;
  href?: string;
}

export interface BreadcrumbTag {
  label: string;
  variant?: TagVariant;
  className?: string;
}

interface BreadcrumbProps {
  crumbs: BreadcrumbCrumb[];
  tags?: BreadcrumbTag[];
}

export function Breadcrumb({ crumbs, tags }: BreadcrumbProps) {
  if (crumbs.length < 2) return null;
  return (
    <div className="px-8 py-3 flex items-center gap-2 bg-white border-b border-neutral-200">
      {crumbs.map((crumb, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <ChevronRight size={14} className="text-neutral-300 shrink-0" />
          )}
          {crumb.href ? (
            <Link
              to={crumb.href}
              className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors cursor-pointer shrink-0"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="text-sm font-semibold text-neutral-900 truncate">
              {crumb.label}
            </span>
          )}
        </Fragment>
      ))}
      {tags && tags.length > 0 && (
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {tags.map((tag, i) => (
            <Badge key={i} variant={tag.variant ?? 'default'} className={tag.className}>
              {tag.label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
