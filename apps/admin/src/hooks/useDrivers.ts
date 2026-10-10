import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

const DRIVERS_KEY = ['drivers'] as const;

export function useDrivers() {
  return useQuery({
    queryKey: DRIVERS_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/drivers');
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { userId: string; driverCode: string }) => {
      const { data, error } = await api.POST('/api/v1/drivers', { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DRIVERS_KEY }),
  });
}

export function useProvisionDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      name: string;
      mobile: string;
      email?: string;
      driverCode: string;
      vehicleId?: string;
    }) => {
      const { data, error } = await api.POST('/api/v1/drivers/provision', { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DRIVERS_KEY }),
  });
}

export function useDriver(id: string | undefined) {
  return useQuery({
    queryKey: ['drivers', 'detail', id] as const,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/drivers/{id}', { params: { path: { id: id! } } });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useUpdateDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, driverCode }: { id: string; driverCode: string }) => {
      const { data, error } = await api.PATCH('/api/v1/drivers/{id}', {
        params: { path: { id } },
        body: { driverCode },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
      queryClient.invalidateQueries({ queryKey: ['drivers', 'detail', id] });
    },
  });
}

export function useApproveDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.PATCH('/api/v1/drivers/{id}/approve', {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
      queryClient.invalidateQueries({ queryKey: ['drivers', 'detail', id] });
    },
  });
}

export function useSuspendDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.PATCH('/api/v1/drivers/{id}/suspend', {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
      queryClient.invalidateQueries({ queryKey: ['drivers', 'detail', id] });
    },
  });
}

export function useAssignVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, vehicleId }: { id: string; vehicleId: string }) => {
      const { data, error } = await api.PATCH('/api/v1/drivers/{id}/vehicle', {
        params: { path: { id } },
        body: { vehicleId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
      queryClient.invalidateQueries({ queryKey: ['drivers', 'detail', id] });
    },
  });
}
