'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useHasRole } from '@/features/auth/useAuthSession';
import { MembersList } from '@/features/tenant-members/components/MembersList';
import { CreateMemberModal } from '@/features/tenant-members/components/CreateMemberModal';
import { PeopleModuleSwitcher } from '@/features/memberships/components/PeopleModuleSwitcher';

const MembersPage = () => {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const router = useRouter();
  const isResident = useHasRole('RESIDENT');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (isResident && tenantId) {
      router.replace(`/${tenantId}/dashboard`);
    }
  }, [isResident, tenantId, router]);

  return (
    <div className="container max-w-4xl mx-auto py-8">
      <div className="mb-6 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Administración de personas
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Residentes del edificio</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona las personas vinculadas a las unidades del edificio. No se usan para asignar tickets.
        </p>
      </div>

      <PeopleModuleSwitcher tenantId={tenantId} active="residents" />

      <MembersList tenantId={tenantId} onCreateClick={() => setShowCreateModal(true)} />

      {showCreateModal && (
        <CreateMemberModal
          tenantId={tenantId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
};

export default MembersPage;
