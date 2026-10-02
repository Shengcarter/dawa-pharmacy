import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { BrandMark } from '@/components/layout/Sidebar';

export function usePublicSettings() {
  return useQuery({
    queryKey: ['public-settings'],
    queryFn: () => api.get<{ pharmacyName: string; address: string | null; logoPath: string | null }>('/public/settings'),
    staleTime: Infinity,
  });
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { data } = usePublicSettings();
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-7 flex items-center gap-2.5">
            {data?.logoPath ? (
              <img src={`/uploads/${data.logoPath}`} alt="" className="size-9 rounded-md object-contain" />
            ) : (
              <BrandMark className="size-9" />
            )}
            <div className="leading-tight">
              <p className="text-[15px] font-semibold">{data?.pharmacyName ?? 'Dawa'}</p>
              <p className="text-[12px] text-muted">Pharmacy management</p>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(16_24_20/0.04)]">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
            <div className="mt-5">{children}</div>
          </div>
        </div>
      </div>
      <p className="pb-6 text-center text-[11.5px] text-faint">Dawa Pharmacy · Secure staff access</p>
    </div>
  );
}
