import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { components } from '@/types/api';

const CAMPUS_LOCATIONS_KEY = ['campus-locations'] as const;

type CreateCampusLocationBody = components['schemas']['CreateCampusLocationDto'];

export function useCampusLocations() {
  return useQuery({
    queryKey: CAMPUS_LOCATIONS_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/campus/locations', {
        params: { query: { includeInactive: true } },
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCampusLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateCampusLocationBody) => {
      const { data, error } = await api.POST('/api/v1/campus/locations', { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CAMPUS_LOCATIONS_KEY }),
  });
}

export function useSetCampusLocationActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { data, error } = await api.PATCH('/api/v1/campus/locations/{id}', {
        params: { path: { id } },
        body: { isActive },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CAMPUS_LOCATIONS_KEY }),
  });
}
