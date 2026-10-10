import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { components } from '@/types/api';

const VEHICLES_KEY = ['vehicles'] as const;

type CreateVehicleBody = components['schemas']['CreateVehicleDto'];
type UpdateVehicleBody = components['schemas']['UpdateVehicleDto'];

export function useVehicles() {
  return useQuery({
    queryKey: VEHICLES_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/vehicles');
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateVehicleBody) => {
      const { data, error } = await api.POST('/api/v1/vehicles', { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VEHICLES_KEY }),
  });
}

export function useUpdateVehicleStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: 'AVAILABLE' | 'IN_SERVICE' | 'MAINTENANCE' | 'INACTIVE';
    }) => {
      const { data, error } = await api.PATCH('/api/v1/vehicles/{id}/status', {
        params: { path: { id } },
        body: { status },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: VEHICLES_KEY });
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'detail', id] });
    },
  });
}

export function useVehicle(id: string | undefined) {
  return useQuery({
    queryKey: ['vehicles', 'detail', id] as const,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/vehicles/{id}', { params: { path: { id: id! } } });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useUpdateVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateVehicleBody & { id: string }) => {
      const { data, error } = await api.PATCH('/api/v1/vehicles/{id}', {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: VEHICLES_KEY });
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'detail', id] });
    },
  });
}
