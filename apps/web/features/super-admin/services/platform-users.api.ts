import { getToken } from '@/features/auth/session.storage';

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface CreatePlatformUserDto {
  name: string;
  email: string;
  password: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function makeRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}/api${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const platformUsersApi = {
  /**
   * Fetches the list of all platform super admin users.
   * Only callable by SUPER_ADMIN users.
   * @returns Promise resolving to array of platform users with id, name, email, createdAt
   */
  async listUsers(): Promise<PlatformUser[]> {
    return makeRequest('/super-admin/platform-users', { method: 'GET' });
  },

  /**
   * Creates a new platform super admin user.
   * Only the founder super admin is allowed to create new users.
   * Password must be at least 8 characters; email must be unique.
   * @param dto - User creation data (name, email, password)
   * @returns Promise resolving to the created PlatformUser object
   */
  async createUser(dto: CreatePlatformUserDto): Promise<PlatformUser> {
    return makeRequest('/super-admin/platform-users', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  /**
   * Deletes a platform super admin user by removing their SUPER_ADMIN role.
   * Only callable by founder super admin.
   * @param userId - The ID of the user to delete
   * @returns Promise resolving when deletion is complete
   */
  async deleteUser(userId: string): Promise<void> {
    return makeRequest(`/super-admin/platform-users/${userId}`, {
      method: 'DELETE',
    });
  },
};
