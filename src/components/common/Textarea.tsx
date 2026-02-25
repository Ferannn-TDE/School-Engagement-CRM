import { type TextareaHTMLAttributes, forwardRef } from 'react';
import { classNames } from '../../utils/helpers';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, required, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-neutral-700 mb-1">
            {label}
            {required && <span className="text-error ml-0.5">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={classNames(
            'w-full rounded-lg border px-3 py-2 text-sm transition-colors resize-y min-h-[80px]',
            'placeholder:text-neutral-400',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            error
              ? 'border-error focus:ring-error/30'
              : 'border-neutral-200 focus:border-siue-red focus:ring-siue-red/30',
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-error" role="alert">{error}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
