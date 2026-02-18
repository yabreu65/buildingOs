'use client';

import { Member } from '../services/invitations.api';
import Card from '@/shared/components/ui/Card';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';

interface MembersListProps {
  members: Member[];
  loading: boolean;
  onRolesClick?: (membershipId: string, memberName: string) => void;
}

export default function MembersList({ members, loading, onRolesClick }: MembersListProps) {
  if (loading) {
    return (
      <Card>
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Membros Ativos</h3>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  if (members.length === 0) {
    return (
      <Card>
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Membros Ativos</h3>
        </div>
        <EmptyState title="Nenhum membro" description="Invite membros para começar" />
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4 flex justify-between items-center">
        <h3 className="text-lg font-semibold">
          Membros Ativos ({members.length})
        </h3>
      </div>
      <div className="space-y-4">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between p-3 border rounded-lg"
          >
            <div className="flex-1">
              <p className="font-medium">{member.name}</p>
              <p className="text-sm text-gray-500">{member.email}</p>
              <div className="flex gap-2 mt-2">
                {member.roles.map((role) => (
                  <Badge key={role} className="bg-blue-100 text-blue-700 border border-blue-300">
                    {role}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onRolesClick && (
                <button
                  onClick={() => onRolesClick(member.id, member.name)}
                  className="px-3 py-1 text-sm font-medium border rounded hover:bg-gray-100"
                >
                  Roles
                </button>
              )}
              <span className="text-sm text-gray-400">
                {new Date(member.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
