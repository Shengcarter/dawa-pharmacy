import { useForm, type FieldValues, type Path, type UseFormProps, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { ApiError } from './api';

/** React Hook Form bound to the same Zod schema the API validates with. */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(schema: S, options?: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'>) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as any,
    mode: 'onTouched',
    ...options,
  });
}

/**
 * Maps a server validation error onto form fields; returns the message for
 * anything that is not field-specific.
 */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T, unknown, FieldValues>, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.fields) {
      for (const [field, message] of Object.entries(err.fields)) {
        form.setError(field as Path<T>, { type: 'server', message });
      }
    }
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');
