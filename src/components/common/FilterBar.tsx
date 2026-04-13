import { Search } from 'lucide-react';
import { Card } from './Card';
import { Select } from './Select';
import { Button } from './Button';

interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  placeholder?: string;
  className?: string;
}

interface FilterBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters: FilterConfig[];
  onClear?: () => void;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filters,
  onClear,
}: FilterBarProps) {
  const hasActiveFilters = filters.some((f) => f.value !== '');

  return (
    <Card>
      <div className="flex flex-wrap gap-x-3 gap-y-3">
        {onSearchChange !== undefined && (
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                placeholder={searchPlaceholder}
                value={searchValue ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-siue-red/30 focus:border-siue-red"
              />
            </div>
          </div>
        )}
        {filters.map((filter, i) => (
          <Select
            key={i}
            options={filter.options}
            placeholder={filter.placeholder}
            value={filter.value}
            onChange={(e) => filter.onChange(e.target.value)}
            className={filter.className}
          />
        ))}
        {onClear && hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear Filters
          </Button>
        )}
      </div>
    </Card>
  );
}
