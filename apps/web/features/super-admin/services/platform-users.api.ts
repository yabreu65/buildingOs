import { apiClient } from '@/shared/lib/http/client';

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

export const platformUsersApi = {
  /**
   * Fetches the list of all platform super admin users.
   * Only callable by SUPER_ADMIN users.
   * @returns Promise resolving to array of platform users with id, name, email, createdAt
   */
  async listUsers(): Promise<PlatformUser[]> {
    return apiClient<PlatformUser[]>({
      path: '/super-admin/platform-users',
      method: 'GET',
    });
  },

  /**
   * Creates a new platform super admin user.
   * Only the founder super admin is allowed to create new users.
   * Password must be at least 8 characters; email must be unique.
   * @param dto - User creation data (name, email, password)
   * @returns Promise resolving to the created PlatformUser object
   */
  async createUser(dto: CreatePlatformUserDto): Promise<PlatformUser> {
    return apiClient<PlatformUser, CreatePlatformUserDto>({
      path: '/super-admin/platform-users',
      method: 'POST',
      body: dto,
    });
  },

  /**
   * Deletes a platform super admin user by removing their SUPER_ADMIN role.
   * Only callable by founder super admin.
   * @param userId - The ID of the user to delete
   * @returns Promise resolving when deletion is complete
   */
  async deleteUser(userId: string): Promise<void> {
    await apiClient<void>({
      path: `/super-admin/platform-users/${userId}`,
      method: 'DELETE',
    });
  },
};
