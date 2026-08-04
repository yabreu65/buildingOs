"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Input from "@/shared/components/ui/Input";
import { Table } from "@/shared/components/ui/Table";
import { useBoStorageTick } from "@/shared/lib/storage/useBoStorage";
import { listBankAccounts, addBankAccount, removeBankAccount } from "./banking.storage";

const schema = z.object({
  bankName: z.string().min(1, "El banco es requerido"),
  accountHolder: z.string().min(1, "El titular es requerido"),
  accountNumber: z.string().min(1, "El número de cuenta es requerido"),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export interface BankingUIProps {
  readonly tenantId: string;
}

export default function BankingUI({ tenantId }: BankingUIProps) {
  const [isCreating, setIsCreating] = useState(false);
  useBoStorageTick();
  const accounts = listBankAccounts(tenantId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = (data: FormData) => {
    addBankAccount(tenantId, data);
    reset();
    setIsCreating(false);
  };

  const handleDelete = (id: string) => {
    if (confirm("¿Estás seguro de eliminar esta cuenta?")) {
      removeBankAccount(tenantId, id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Cuentas Bancarias</h2>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)}>Nueva Cuenta</Button>
        )}
      </div>

      {isCreating && (
        <Card className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Banco
                </label>
                <Input {...register("bankName")} placeholder="Ej: Banco Nacional" />
                {errors.bankName && (
                  <p className="mt-1 text-sm text-red-500">{errors.bankName.message}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Titular
                </label>
                <Input {...register("accountHolder")} placeholder="Ej: Consorcio Torre A" />
                {errors.accountHolder && (
                  <p className="mt-1 text-sm text-red-500">{errors.accountHolder.message}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Número de Cuenta / CBU / IBAN
                </label>
                <Input {...register("accountNumber")} placeholder="0000..." />
                {errors.accountNumber && (
                  <p className="mt-1 text-sm text-red-500">{errors.accountNumber.message}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Notas (Opcional)
                </label>
                <Input {...register("notes")} placeholder="Cuenta principal..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsCreating(false);
                  reset();
                }}
              >
                Cancelar
              </Button>
              <Button type="submit">Guardar Cuenta</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden">
        {accounts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No hay cuentas bancarias registradas. Agrega una para recibir pagos.
          </div>
        ) : (
          <Table>
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Banco</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Titular</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Número</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Notas</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => (
                <tr key={acc.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 text-sm font-medium text-foreground">{acc.bankName}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{acc.accountHolder}</td>
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground">{acc.accountNumber}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{acc.notes || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(acc.id)}
                    >
                      Eliminar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
