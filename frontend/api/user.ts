import { axiosInstance } from './axios.js';
import type { AuthUser } from './auth';

export type UpdatePreferencesPayload = {
  userId: string;
  voiceCloningEnabled: boolean;
};

export type UpdatePreferencesResponse = {
  status: boolean;
  message: string;
  user?: AuthUser & { voiceCloningEnabled?: boolean };
};

export async function updatePreferences(
  payload: UpdatePreferencesPayload,
): Promise<UpdatePreferencesResponse> {
  const { data } = await axiosInstance.patch<UpdatePreferencesResponse>(
    'auth/preferences',
    payload,
  );
  return data;
}

