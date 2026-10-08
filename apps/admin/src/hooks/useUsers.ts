import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { components } from '@/types/api';

export type UserRole = components['schemas']['UserResponseDto']['role'];

export interface UsersQuery {
  role?: UserRole;
  search?: string;
  limit: number;
  offset: number;
}

const USERS_KEY = (query: UsersQuery) => ['users', query] as const;

export function useUsers(query: UsersQuery) {
  return useQuery({
    queryKey: USERS_KEY(query),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/users', {
        params: {
          query: {
            role: query.role,
            search: query.search || undefined,
            limit: query.limit,
            offset: query.offset,
          },
        },
      });
      if (error) throw error;
      return data;
    },
    // GET /api/v1/users is @Roles('ADMIN') only (docs/open-items.md #40) - an
    // OPERATOR hitting this gets a 403. Don't retry on it; the page renders a
    // dedicated "no access" message instead of a spinner that never resolves.
    retry: (failureCount, err) => {
      if (isForbidden(err)) return false;
      return failureCount < 3;
    },
  });
}

export function isForbidden(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const statusCode = (err as { statusCode?: unknown; status?: unknown }).statusCode ?? (err as { status?: unknown }).status;
  return statusCode === 403;
}
