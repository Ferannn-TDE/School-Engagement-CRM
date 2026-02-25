import { type InputHTMLAttributes, forwardRef } from 'react';
import { classNames } from '../../utils/helpers';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helpText, className, id, required, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-neutral-700 mb-1">
            {label}
            {required && <span className="text-error ml-0.5">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={classNames(
            'w-full rounded-lg border px-3 py-2 text-sm transition-colors',
            'placeholder:text-neutral-400',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            error
              ? 'border-error focus:ring-error/30'
              : 'border-neutral-200 focus:border-siue-red focus:ring-siue-red/30',
            className
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${inputId}-error` : helpText ? `${inputId}-help` : undefined}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="mt-1 text-sm text-error" role="alert">
            {error}
          </p>
        )}
        {helpText && !error && (
          <p id={`${inputId}-help`} className="mt-1 text-sm text-neutral-400">
            {helpText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
