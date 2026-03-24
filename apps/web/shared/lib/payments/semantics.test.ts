import { getPaymentStatusLabel, paymentStatusLabels } from './semantics';

type LabelCase = {
  status: keyof typeof paymentStatusLabels;
  unit: string;
  admin: string;
};

const labelCases: LabelCase[] = [
  {
    status: 'PENDING',
    unit: 'En revision',
    admin: 'Pendiente de confirmacion',
  },
  {
    status: 'SUBMITTED',
    unit: 'Pago reportado',
    admin: 'Pendiente de confirmacion',
  },
  {
    status: 'APPROVED',
    unit: 'Pago confirmado',
    admin: 'Confirmado',
  },
  {
    status: 'REJECTED',
    unit: 'Pago rechazado',
    admin: 'Rechazado',
  },
  {
    status: 'RECONCILED',
    unit: 'Conciliado',
    admin: 'Conciliado',
  },
];

describe('paymentStatusLabels', () => {
  it('returns role-aware labels for each payment status', () => {
    labelCases.forEach(({ status, unit, admin }) => {
      expect(getPaymentStatusLabel(status, 'unit')).toBe(unit);
      expect(getPaymentStatusLabel(status, 'admin')).toBe(admin);
    });
  });
});
