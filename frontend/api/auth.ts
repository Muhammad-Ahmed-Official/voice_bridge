import { API_BASE_URL } from "./axios";

export type AuthUser = {
  _id: string;
  userId: string;
  name: string;
  voiceCloningEnabled?: boolean;
};

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
  const { data } = await API_BASE_URL.post<SignInResponse>('auth/signin', payload);
  return data;
}

export async function signUpApi(payload: SignUpPayload): Promise<SignUpResponse> {
  const { data } = await API_BASE_URL.post<SignUpResponse>('auth/signup', payload);
  return data;
}
