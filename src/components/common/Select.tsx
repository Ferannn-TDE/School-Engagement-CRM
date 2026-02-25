import { type SelectHTMLAttributes, forwardRef } from 'react';
import { classNames } from '../../utils/helpers';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, required, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-neutral-700 mb-1">
            {label}
            {required && <span className="text-error ml-0.5">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={classNames(
            'w-full rounded-lg border px-3 py-2 text-sm transition-colors bg-white',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            error
              ? 'border-error focus:ring-error/30'
              : 'border-neutral-200 focus:border-siue-red focus:ring-siue-red/30',
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="">{placeholder}</option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="mt-1 text-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
