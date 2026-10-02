import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: ToastTone; title: string; description?: string }

const ToastContext = createContext<{ push: (t: Omit<ToastItem, 'id'>) => void } | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = nextId++;
      setItems((all) => [...all.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
          {items.map((t) => {
            const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertCircle : Info;
            return (
              <div key={t.id} className="animate-pop pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 shadow-pop">
                <Icon className={cn('mt-0.5 size-4 shrink-0', t.tone === 'success' && 'text-brand-600', t.tone === 'error' && 'text-danger', t.tone === 'info' && 'text-info')} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-[12.5px] text-muted">{t.description}</p>}
                </div>
                <button aria-label="Dismiss" className="text-faint hover:text-fg" onClick={() => dismiss(t.id)}>
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return {
    success: (title: string, description?: string) => ctx.push({ tone: 'success', title, description }),
    error: (title: string, description?: string) => ctx.push({ tone: 'error', title, description }),
    info: (title: string, description?: string) => ctx.push({ tone: 'info', title, description }),
  };
}
