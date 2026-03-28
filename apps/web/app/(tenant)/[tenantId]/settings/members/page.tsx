'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useHasRole } from '@/features/auth/useAuthSession';
import { MembersList } from '@/features/tenant-members/components/MembersList';
import { CreateMemberModal } from '@/features/tenant-members/components/CreateMemberModal';

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
