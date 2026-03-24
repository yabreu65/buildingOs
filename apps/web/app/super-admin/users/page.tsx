'use client';

import { useEffect, useState } from 'react';
import Button from '@/shared/components/ui/Button';
import { platformUsersApi, PlatformUser } from '@/features/super-admin/services/platform-users.api';
import { CreateUserModal } from '@/features/super-admin/components/CreateUserModal';
import { DeleteUserModal } from '@/features/super-admin/components/DeleteUserModal';

export default function UsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await platformUsersApi.listUsers();
      setUsers(data);
      setError(null);
    } catch (err) {
      setError('Failed to load users');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (name: string, email: string, password: string) => {
    try {
      await platformUsersApi.createUser({ name, email, password });
      setShowCreateModal(false);
      await loadUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await platformUsersApi.deleteUser(userId);
      setShowDeleteModal(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
          Platform Users
        </h1>
        <p className="text-muted-foreground mt-2">Gestión de super admins y usuarios globales</p>
      </div>

      {/* Action Button */}
      <div className="flex gap-3">
        <Button onClick={() => setShowCreateModal(true)}>+ Crear Super Admin</Button>
      </div>

      {/* Users Table */}
      <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
        <h2 className="text-xl font-bold text-foreground mb-6">👥 Super Admin Users</h2>

        {loading && <div className="text-muted-foreground text-center py-8">Cargando usuarios...</div>}

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-4 rounded-lg mb-4">
            {error}
          </div>
        )}

        {!loading && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Nombre</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Email</th>
                  <th className="text-left py-3 px-4 font-semibold text-foreground">Creado</th>
                  <th className="text-right py-3 px-4 font-semibold text-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/50 transition-colors">
                    <td className="py-3 px-4 text-foreground font-medium">{user.name}</td>
                    <td className="py-3 px-4 text-muted-foreground">{user.email}</td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setShowDeleteModal(true);
                        }}
                        className="text-red-600 hover:text-red-700 text-sm font-medium transition-colors"
                      >
                        🗑️ Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && users.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            📭 No hay usuarios super admin creados
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateUserModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateUser}
        />
      )}

      {showDeleteModal && selectedUser && (
        <DeleteUserModal
          user={selectedUser}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedUser(null);
          }}
          onConfirm={() => handleDeleteUser(selectedUser.id)}
        />
      )}
    </div>
  );
}
