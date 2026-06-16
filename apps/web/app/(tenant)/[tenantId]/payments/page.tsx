import { redirect } from 'next/navigation';

interface PaymentsSubmitPageProps {
  params: {
    tenantId: string;
  };
}

export default function PaymentsSubmitPage({ params }: PaymentsSubmitPageProps) {
  redirect(`/${params.tenantId}/resident/payments`);
}
