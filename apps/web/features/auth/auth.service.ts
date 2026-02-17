import { apiClient } from '@/shared/lib/http/client';
import type { LoginResponse } from './auth.types';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SignupPayload {
  email: string;
  name: string;
  password: string;
  tenantName?: string;
  tenantType?: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
}

export async function apiLogin(payload: LoginPayload): Promise<LoginResponse> {
  return apiClient<LoginResponse, LoginPayload>({
    path: '/auth/login',
    method: 'POST',
    body: payload,
  });
}

export async function apiSignup(payload: SignupPayload): Promise<LoginResponse> {
  return apiClient<LoginResponse, SignupPayload>({
    path: '/auth/signup',
    method: 'POST',
    body: payload,
  });
}

export async function apiMe(): Promise<LoginResponse> {
  return apiClient<LoginResponse>({
    path: '/auth/me',
    method: 'GET',
  });
}
