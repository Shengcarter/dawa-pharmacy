import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Branch { id: number; code: string; name: string; address: string | null; phone: string | null; isActive: boolean; userCount: number; stockValue: number }

export function useBranches() {
  return useQuery({ queryKey: ['branches'], queryFn: () => api.get<Branch[]>('/branches'), staleTime: 300_000 });
}
