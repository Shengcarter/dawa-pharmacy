import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Full width unless the caller sets a width. */
const width = (className?: string) => (/(^|\s)(w-|max-w-|flex-1)/.test(className ?? '') ? '' : 'w-full');

const control =
  'rounded-md border border-line-strong bg-surface text-[13px] text-fg placeholder:text-faint transition-colors ' +
  'hover:border-faint focus:border-brand-600 focus:outline-none focus:ring-3 focus:ring-[var(--ring)] ' +
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-danger';

export interface FieldProps {
  label?: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
  action?: ReactNode;
}

/** Label + control + hint/error, wired for accessibility. */
export function Field({ label, required, error, hint, className, children, action }: FieldProps) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && (
        <div className="flex items-center justify-between">
          <label htmlFor={id} className="text-[12.5px] font-medium text-fg">
            {label}
            {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
          </label>
          {action}
        </div>
      )}
      {children(id)}
      {error ? (
        <p className="text-[12px] text-danger" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; prefix?: ReactNode; suffix?: ReactNode }>(
  function Input({ className, invalid, prefix, suffix, ...rest }, ref) {
    if (prefix || suffix) {
      return (
        <div className={cn('relative flex items-center', className)}>
          {prefix && <span className="pointer-events-none absolute left-2.5 text-[12px] text-muted">{prefix}</span>}
          <input
            ref={ref}
            aria-invalid={invalid || undefined}
            className={cn(control, 'h-8.5 w-full', prefix ? 'pl-11' : 'pl-2.5', suffix ? 'pr-10' : 'pr-2.5')}
            {...rest}
          />
          {suffix && <span className="pointer-events-none absolute right-2.5 text-[12px] text-muted">{suffix}</span>}
        </div>
      );
    }
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, width(className), 'h-8.5 px-2.5', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={cn(control, width(className), 'px-2.5 py-1.5 leading-relaxed', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; placeholder?: string }>(
  function Select({ className, invalid, children, placeholder, ...rest }, ref) {
    return (
      <div className={cn('relative', className)}>
        <select ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'h-8.5 w-full appearance-none pl-2.5 pr-8')} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
      </div>
    );
  },
);

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-[13px]', className)}>
      <input type="checkbox" className="size-3.5 cursor-pointer rounded border-line-strong accent-[var(--brand-600)]" {...rest} />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-[13px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-[12.5px] text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-line-strong',
        )}
      >
        <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(control, 'h-8.5 w-full pl-8 pr-7')}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Groups related form fields under a heading. */
export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('grid gap-x-8 gap-y-4 border-b border-line py-6 last:border-0 lg:grid-cols-[220px_1fr]', className)}>
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
