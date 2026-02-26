import { axiosInstance } from './axios.js';

export type AuthUser = { _id: string; userId: string; name: string };

export type SignInPayload = { userId: string; password: string };
export type SignUpPayload = { userId: string; password: string };

export type SignInResponse = {
  status: boolean;
  message: string;
  user?: AuthUser;
};

export type SignUpResponse = {
  status: boolean;
  message: string;
};

export async function signInApi(payload: SignInPayload): Promise<SignInResponse> {
  const { data } = await axiosInstance.post<SignInResponse>('auth/signin', payload);
  return data;
}

export async function signUpApi(payload: SignUpPayload): Promise<SignUpResponse> {
  const { data } = await axiosInstance.post<SignUpResponse>('auth/signup', payload);
  return data;
}
