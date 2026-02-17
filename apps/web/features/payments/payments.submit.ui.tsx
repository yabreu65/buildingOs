'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Input from '@/shared/components/ui/Input';
import Select from '@/shared/components/ui/Select';
import Button from '@/shared/components/ui/Button';
import { mockUnits } from '../units/units.mock';
import { formatMoney } from '@/shared/lib/format/money';
import { paymentSubmitSchema, type PaymentSubmitFormValues } from './payments.schema';
import { toPayment } from './payments.adapter';
import { submitPayment } from './payments.storage';
import { useBoStorageTick } from '@/shared/lib/storage/useBoStorage';
import { getSession } from '../auth/session.storage';

export default function PaymentSubmitUI() {
  // Força re-render cuando cambie el storage
  useBoStorageTick();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<PaymentSubmitFormValues>({
    resolver: zodResolver(paymentSubmitSchema),
    defaultValues: {
      unitId: '',
      amount: 0,
      reference: '',
      paidAt: new Date().toISOString().split('T')[0],
    },
  });

  const onSubmit = async (formData: PaymentSubmitFormValues) => {
    try {
      const session = getSession();
      if (!session) {
        alert('No hay sesión activa');
        return;
      }

      // Adapter: FormValues → Payment
      const paymentInput = toPayment(formData);

      // Guardar en storage
      const created = submitPayment(session.activeTenantId, paymentInput);

      // Feedback y reset
      alert(`Pago enviado: ${created.unitId} - ${formatMoney(created.amount)}`);
      reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      alert(`Error: ${message}`);
    }
  };

  return (
    <form className="max-w-md space-y-4" onSubmit={handleSubmit(onSubmit)}>
      <div>
        <label htmlFor="unitId" className="block text-sm font-medium mb-1">
          Unidad
        </label>
        <Select
          id="unitId"
          {...register('unitId', { required: 'Selecciona una unidad' })}
        >
          <option value="">-- Seleccionar --</option>
          {mockUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </Select>
        {errors.unitId && (
          <p className="text-xs text-red-600 mt-1">{errors.unitId.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="amount" className="block text-sm font-medium mb-1">
          Monto
        </label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          placeholder="0.00"
          {...register('amount', { valueAsNumber: true })}
        />
        {errors.amount && (
          <p className="text-xs text-red-600 mt-1">{errors.amount.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="paidAt" className="block text-sm font-medium mb-1">
          Fecha de pago
        </label>
        <Input id="paidAt" type="date" {...register('paidAt')} />
        {errors.paidAt && (
          <p className="text-xs text-red-600 mt-1">{errors.paidAt.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="reference" className="block text-sm font-medium mb-1">
          Referencia (opcional)
        </label>
        <Input
          id="reference"
          type="text"
          placeholder="Ej: Transferencia #12345"
          {...register('reference')}
        />
        {errors.reference && (
          <p className="text-xs text-red-600 mt-1">{errors.reference.message}</p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'Enviando...' : 'Enviar pago'}
      </Button>
    </form>
  );
}
